// Mandate control API. The operator configures entrusted capital + portfolio
// risk here, and starts/pauses/stops the hunt. GET returns the current mandate
// plus a live accounting snapshot (principal / deployed / available / equity /
// drawdown). POST updates fields or runs a status action.
//
// The mandate holds NO secret. Live wallet balance is read only to prevent
// setting principal above what the wallet actually holds; the key never leaves
// trade-wallet.ts and is never serialized.

import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import {
  loadMandate,
  saveMandate,
  setMandateStatus,
} from "@/lib/mandate-store";
import {
  computeAccounting,
  type Mandate,
  type MandateStatus,
} from "@/lib/mandate";
import { recordMandateAudit, diffMandate } from "@/lib/mandate-audit";
import {
  getOpenPositions,
  getTotalRealizedPnlSol,
  getRealizedPnlToday,
  computeUnrealizedPnlSol,
} from "@/lib/position-store";
import { monitorPositions } from "@/lib/trade-exit";
import { getJupiterPrices } from "@/lib/jupiter";
import { getTradeConfig } from "@/lib/trade-config";
import {
  loadKeypair,
  getConnection,
  getBalanceSol,
} from "@/lib/trade-wallet";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function clampNum(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

// A malformed secret key must not 500 the route — treat as no wallet (dry-run).
function loadKeypairSafe() {
  try {
    return loadKeypair();
  } catch {
    return null;
  }
}

// Build the live accounting snapshot for a mandate: deployed from open positions,
// realized from the ledger, unrealized from current Jupiter prices.
async function buildAccounting(mandate: Mandate) {
  const cfg = getTradeConfig();
  const open = await getOpenPositions();
  const deployedSol = open.reduce((s, p) => s + p.entrySol, 0);
  const realizedPnlSol = await getTotalRealizedPnlSol();

  let unrealizedPnlSol = 0;
  if (open.length > 0) {
    const prices = await getJupiterPrices(open.map((p) => p.mint));
    unrealizedPnlSol = open.reduce((s, p) => {
      const price = prices.get(p.mint)?.usdPrice;
      return price == null ? s : s + computeUnrealizedPnlSol(p, price);
    }, 0);
  }

  const acct = computeAccounting({
    mandate,
    deployedSol,
    realizedPnlSol,
    unrealizedPnlSol,
    maxSolPerTrade: cfg.maxSolPerTrade,
  });
  const realizedTodaySol = await getRealizedPnlToday();
  return { acct, openCount: open.length, realizedTodaySol };
}

export async function GET() {
  try {
    const mandate = await loadMandate();
    const cfg = getTradeConfig();
    const { acct, openCount, realizedTodaySol } = await buildAccounting(mandate);
    return NextResponse.json({
      mandate,
      accounting: { ...acct, openCount, realizedTodaySol, maxOpenPositions: mandate.maxOpenPositions },
      // Server-enforced reserve floor (= operator wallet minimum). The UI uses it
      // as the reserve slider's min so a client value can't be silently raised.
      minReserveSol: cfg.minWalletSol,
    });
  } catch (error) {
    console.error("[/api/mandate GET]", error);
    const message = error instanceof Error ? error.message : "Failed to load mandate";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

interface UpdateBody {
  principalSol?: number;
  perTradePctOfPrincipal?: number;
  reserveSol?: number;
  maxOpenPositions?: number;
  maxDrawdownPct?: number;
  dailyLossLimitPct?: number;
  onDrawdownBreach?: Mandate["onDrawdownBreach"];
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const current = await loadMandate();
    const cfg = getTradeConfig();

    // ── Status actions ──────────────────────────────────────────────────
    if (action === "pause") {
      const next = await setMandateStatus("paused");
      await recordMandateAudit({ action: "pause", changes: ["status -> paused"] });
      return NextResponse.json({ ok: true, mandate: next });
    }

    if (action === "resume") {
      // Only allow resume -> active; a resumed mandate restamps startedAt.
      const next = await setMandateStatus("active");
      await recordMandateAudit({ action: "resume", changes: ["status -> active"] });
      return NextResponse.json({ ok: true, mandate: next });
    }

    if (action === "stop") {
      // Flip status to stopped FIRST so no new entry races in. With
      // liquidate=true, run one exit tick with forceLiquidateAll — this reuses
      // decideSells's kill-switch branch to dump every position's sellable
      // amount (the manual-hold moon bag is still protected). In dry-run this
      // only logs; a live mandate signs the sells.
      const body = (await req.json().catch(() => ({}))) as { liquidate?: boolean };
      const openBefore = await getOpenPositions();
      const next = await setMandateStatus("stopped");

      let liquidationNote: string | null = null;
      if (body.liquidate && openBefore.length > 0) {
        try {
          await monitorPositions(cfg, new Date(), true);
          liquidationNote = `force-liquidated ${openBefore.length} position(s)`;
        } catch (e) {
          liquidationNote = `liquidation tick failed: ${e instanceof Error ? e.message : "error"}`;
        }
      }
      await recordMandateAudit({
        action: body.liquidate ? "stop-liquidate" : "stop",
        changes: ["status -> stopped", ...(liquidationNote ? [liquidationNote] : [])],
      });
      return NextResponse.json({
        ok: true,
        mandate: next,
        openPositions: openBefore.length,
        liquidationNote,
      });
    }

    // ── Field update (also the way to go active from the editor) ──────────
    const body = (await req.json()) as UpdateBody & { status?: MandateStatus };

    const reserveSol = clampNum(
      body.reserveSol,
      cfg.minWalletSol, // reserve must be at least the operator wallet floor
      100000,
      Math.max(current.reserveSol, cfg.minWalletSol),
    );
    const principalSol = clampNum(body.principalSol, 0, 100000, current.principalSol);

    // Live guard: principal + reserve must not exceed the real wallet balance.
    // Only runs when the operator is RAISING committed capital — lowering it, or
    // editing unrelated risk fields (drawdown, maxOpen, breach action), never
    // needs a balance check, so an RPC hiccup can't block those saves.
    const raisingCommitted =
      principalSol > current.principalSol + 1e-9 ||
      reserveSol > current.reserveSol + 1e-9;
    const keypair = loadKeypairSafe();
    if (cfg.mode === "live" && keypair && raisingCommitted) {
      try {
        const conn = getConnection(cfg);
        const balance = await getBalanceSol(conn, new PublicKey(keypair.publicKey.toBase58()));
        if (principalSol + reserveSol > balance + 1e-9) {
          return NextResponse.json(
            {
              error: `Vốn uỷ thác (${principalSol} SOL) + reserve (${reserveSol} SOL) vượt số dư ví thật (${balance.toFixed(4)} SOL).`,
            },
            { status: 400 },
          );
        }
      } catch (e) {
        // Can't read balance — fail closed on RAISING committed capital in live
        // mode (never let an unverifiable increase through).
        return NextResponse.json(
          { error: `Không đọc được số dư ví để xác thực vốn uỷ thác: ${e instanceof Error ? e.message : "RPC error"}` },
          { status: 503 },
        );
      }
    }

    const validStatus: MandateStatus[] = ["active", "paused", "stopped"];
    const status = validStatus.includes(body.status as MandateStatus)
      ? (body.status as MandateStatus)
      : current.status;

    const next = await saveMandate({
      status,
      principalSol,
      startedAt: status === "active" && current.status !== "active"
        ? new Date().toISOString()
        : current.startedAt,
      perTradePctOfPrincipal: clampNum(body.perTradePctOfPrincipal, 1, 100, current.perTradePctOfPrincipal),
      reserveSol,
      maxOpenPositions: Math.round(clampNum(body.maxOpenPositions, 1, 1000, current.maxOpenPositions)),
      maxDrawdownPct: clampNum(body.maxDrawdownPct, 1, 100, current.maxDrawdownPct),
      dailyLossLimitPct: clampNum(body.dailyLossLimitPct, 1, 100, current.dailyLossLimitPct),
      onDrawdownBreach:
        body.onDrawdownBreach === "halt-and-liquidate" ? "halt-and-liquidate" : "halt",
    });

    const changes = diffMandate(
      current as unknown as Record<string, unknown>,
      next as unknown as Record<string, unknown>,
    );
    if (changes.length > 0) {
      await recordMandateAudit({ action: "update", changes });
    }

    return NextResponse.json({ ok: true, mandate: next, minReserveSol: cfg.minWalletSol });
  } catch (error) {
    console.error("[/api/mandate POST]", error);
    const message = error instanceof Error ? error.message : "Failed to update mandate";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
