import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import {
  getAllPositions,
  clearAllPositions,
  computeUnrealizedPnlSol,
  getOpenPositions,
  writeOffPosition,
  type Position,
  type Fill,
} from "@/lib/position-store";
import {
  loadKeypair,
  getConnection,
  getBalanceSol,
} from "@/lib/trade-wallet";
import { getJupiterPrices } from "@/lib/jupiter";
import { loadSettings } from "@/lib/settings-store";
import { getTradeConfig, effectiveMode } from "@/lib/trade-config";
import { loadMandate } from "@/lib/mandate-store";
import { computeAccounting } from "@/lib/mandate";
import { getRealizedPnlToday } from "@/lib/position-store";
import { readLiveScanState } from "@/lib/live-scan-store";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const WSOL_MINT = "So11111111111111111111111111111111111111112";

// One buy or sell leg, shaped for the dashboard. SOL is signed from the wallet's
// perspective: a buy spends SOL (negative), a sell receives SOL (positive).
interface TradeLeg {
  time: string;
  kind: Fill["kind"];
  pct: number;
  priceUsd: number;
  solFlow: number; // negative on buy, positive on sell
  tokenAmount: number;
  reason: string | null;
  txSig: string | null;
  dryRun: boolean;
  // Realized P&L in SOL for a sell leg (SOL received minus proportional entry
  // cost). null for buys and for non-advancing (errored) fills.
  realizedPnlSol: number | null;
}

interface GemSummary {
  id: string;
  mint: string;
  symbol: string;
  status: Position["status"];
  mode: Position["mode"];
  entryTime: string;
  closedTime: string | null;
  closedReason: string | null;
  entryPriceUsd: number;
  entrySol: number;
  // Price per token denominated in SOL, for the SOL-rate view. entryPriceSol is
  // exact (SOL spent / tokens received at entry, no SOL/USD conversion needed).
  // currentPriceSol derives from the current USD price and the live SOL/USD rate;
  // null when either is unavailable. Open positions only — null for closed.
  entryPriceSol: number | null;
  currentPriceSol: number | null;
  soldPct: number;
  realizedPnlSol: number;
  unrealizedPnlSol: number; // 0 for closed positions
  totalPnlSol: number; // realized + unrealized
  legs: TradeLeg[];
}

// A point in the wallet's realized-P&L-over-time series (chart data). value is
// cumulative realized P&L in SOL up to and including this fill.
interface SeriesPoint {
  time: string;
  cumulativePnlSol: number;
}

function toLegs(pos: Position): TradeLeg[] {
  const legs: TradeLeg[] = [];
  for (const f of pos.fills) {
    if (f.reason === "reconcile") continue; // bookkeeping marker, not a trade
    const advancing = !f.error;
    let realizedPnlSol: number | null = null;
    if (f.kind === "sell" && advancing) {
      const entryCostForFill = pos.entrySol * (f.pct / 100);
      realizedPnlSol = f.sol - entryCostForFill;
    }
    legs.push({
      time: f.time,
      kind: f.kind,
      pct: f.pct,
      priceUsd: f.priceUsd,
      solFlow: f.kind === "buy" ? -f.sol : f.sol,
      tokenAmount: f.tokenAmount,
      reason: f.reason ?? null,
      txSig: f.txSig,
      dryRun: f.dryRun,
      realizedPnlSol,
    });
  }
  return legs;
}

export async function GET() {
  try {
    const positions = await getAllPositions();

    // SOL/USD for converting SOL figures to USD on the client. Degrades to null.
    const priceMap = await getJupiterPrices([WSOL_MINT]);
    const solPriceUsd = priceMap.get(WSOL_MINT)?.usdPrice ?? null;

    // Current price per held mint (for unrealized P&L on open positions).
    const openMints = positions
      .filter((p) => p.status === "open")
      .map((p) => p.mint);
    const openPriceMap =
      openMints.length > 0 ? await getJupiterPrices(openMints) : new Map();

    const gems: GemSummary[] = positions.map((pos) => {
      const currentPriceUsd =
        openPriceMap.get(pos.mint)?.usdPrice ?? pos.peakPriceUsd;
      const unrealizedPnlSol =
        pos.status === "open"
          ? computeUnrealizedPnlSol(pos, currentPriceUsd)
          : 0;
      // SOL-rate view (open positions only). entryPriceSol is the exact token/SOL
      // rate paid at entry; currentPriceSol converts the live USD price via the
      // current SOL/USD rate so the two can be compared like-for-like.
      const entryPriceSol =
        pos.status === "open" && pos.tokenAmount > 0
          ? pos.entrySol / pos.tokenAmount
          : null;
      const currentPriceSol =
        pos.status === "open" && solPriceUsd != null && solPriceUsd > 0
          ? currentPriceUsd / solPriceUsd
          : null;
      return {
        id: pos.id,
        mint: pos.mint,
        symbol: pos.symbol,
        status: pos.status,
        mode: pos.mode,
        entryTime: pos.entryTime,
        closedTime: pos.closedTime ?? null,
        closedReason: pos.closedReason ?? null,
        entryPriceUsd: pos.entryPriceUsd,
        entrySol: pos.entrySol,
        entryPriceSol,
        currentPriceSol,
        soldPct: pos.soldPct,
        realizedPnlSol: pos.realizedPnlSol,
        unrealizedPnlSol,
        totalPnlSol: pos.realizedPnlSol + unrealizedPnlSol,
        legs: toLegs(pos),
      };
    });

    // Sort newest entry first for the table.
    gems.sort((a, b) => b.entryTime.localeCompare(a.entryTime));

    // Cumulative realized-P&L series: every advancing sell across all positions,
    // ordered by time, accumulated. This is the wallet's realized P&L curve.
    const sellLegs = gems
      .flatMap((g) => g.legs.map((l) => ({ ...l, symbol: g.symbol })))
      .filter((l) => l.kind === "sell" && l.realizedPnlSol !== null)
      .sort((a, b) => a.time.localeCompare(b.time));

    let running = 0;
    const series: SeriesPoint[] = sellLegs.map((l) => {
      running += l.realizedPnlSol ?? 0;
      return { time: l.time, cumulativePnlSol: running };
    });

    // Portfolio-level roll-ups.
    const totalRealizedPnlSol = gems.reduce((s, g) => s + g.realizedPnlSol, 0);
    const totalUnrealizedPnlSol = gems.reduce(
      (s, g) => s + g.unrealizedPnlSol,
      0,
    );
    const closed = gems.filter((g) => g.status === "closed");
    const wins = closed.filter((g) => g.realizedPnlSol > 0).length;
    const winRate = closed.length > 0 ? (wins / closed.length) * 100 : null;

    // Wallet SOL balance — only when a signer is configured. Never expose the key.
    let walletBalanceSol: number | null = null;
    let walletAddress: string | null = null;
    const keypair = loadKeypairSafe();
    if (keypair) {
      walletAddress = keypair.publicKey.toBase58();
      try {
        const conn = getConnection();
        walletBalanceSol = await getBalanceSol(
          conn,
          new PublicKey(walletAddress),
        );
      } catch {
        walletBalanceSol = null; // RPC hiccup; UI shows "unavailable"
      }
    }

    // Mandate accounting — reuse the realized/unrealized totals already computed
    // above (no extra price fetch). deployedSol is Σ entrySol of open positions.
    const mandate = await loadMandate();
    const cfg = getTradeConfig();
    const deployedSol = positions
      .filter((p) => p.status === "open")
      .reduce((s, p) => s + p.entrySol, 0);
    const mandateAcct = computeAccounting({
      mandate,
      deployedSol,
      realizedPnlSol: totalRealizedPnlSol,
      unrealizedPnlSol: totalUnrealizedPnlSol,
      maxSolPerTrade: cfg.maxSolPerTrade,
    });
    const realizedTodaySol = await getRealizedPnlToday();
    const settings = loadSettings();
    const liveScan = await readLiveScanState();
    const isWorkerActive = (Date.now() - new Date(liveScan.updatedAt).getTime()) < 3 * 60_000;

    return NextResponse.json({
      effectiveMode: effectiveMode({ autoBuyEnabled: settings.autoBuyEnabled }),
      isWorkerActive,
      solPriceUsd,
      wallet: {
        address: walletAddress,
        balanceSol: walletBalanceSol,
      },
      mandate: {
        status: mandate.status,
        principalSol: mandate.principalSol,
        perTradePctOfPrincipal: mandate.perTradePctOfPrincipal,
        reserveSol: mandate.reserveSol,
        maxOpenPositions: mandate.maxOpenPositions,
        maxDrawdownPct: mandate.maxDrawdownPct,
        dailyLossLimitPct: mandate.dailyLossLimitPct,
        onDrawdownBreach: mandate.onDrawdownBreach,
        startedAt: mandate.startedAt,
      },
      mandateAccounting: {
        ...mandateAcct,
        realizedTodaySol,
        openCount: positions.filter((p) => p.status === "open").length,
      },
      totals: {
        realizedPnlSol: totalRealizedPnlSol,
        unrealizedPnlSol: totalUnrealizedPnlSol,
        totalPnlSol: totalRealizedPnlSol + totalUnrealizedPnlSol,
        openCount: gems.filter((g) => g.status === "open").length,
        closedCount: closed.length,
        winRate,
      },
      series,
      gems,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[/api/portfolio]", error);
    const message =
      error instanceof Error ? error.message : "Failed to load portfolio";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST ?action=abandon — manual write-off of a single open position that can no
// longer be sold (rugpull). Operator-triggered twin of the exit monitor's
// automatic rugpull write-off: it books the unsold remainder as a realized loss
// and closes the position so its slot + deployed capital are freed immediately,
// without waiting for the monitor to accrue three failed sells.
//
// Body: { positionId: string }. We do NOT attempt a recovery sell here — the
// button exists precisely for tokens the operator has confirmed are dead; the
// exit monitor already tries (and keeps trying) to sell sellable positions.
export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    if (action !== "abandon") {
      return NextResponse.json({ error: "Invalid action." }, { status: 400 });
    }

    const body = (await req.json().catch(() => ({}))) as { positionId?: string };
    const positionId = body.positionId;
    if (!positionId) {
      return NextResponse.json({ error: "Missing positionId." }, { status: 400 });
    }

    const open = await getOpenPositions();
    const pos = open.find((p) => p.id === positionId);
    if (!pos) {
      return NextResponse.json(
        { error: "Open position not found." },
        { status: 404 },
      );
    }

    const off = await writeOffPosition(positionId, "manual-writeoff");
    if (!off) {
      return NextResponse.json(
        { error: "Position already closed or cannot be written off." },
        { status: 409 },
      );
    }

    return NextResponse.json({
      ok: true,
      position: {
        id: off.id,
        symbol: off.symbol,
        status: off.status,
        closedReason: off.closedReason ?? null,
        realizedPnlSol: off.realizedPnlSol,
      },
    });
  } catch (error) {
    console.error("[/api/portfolio POST abandon]", error);
    const message =
      error instanceof Error ? error.message : "Failed to write off position";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE — wipe the position ledger ("Reset mô phỏng" on the dashboard). Guarded:
// if the bot is configured for LIVE trading with a real wallet, the ledger holds
// real-money history, so we refuse. In dry-run (the sim default) it clears freely.
export async function DELETE() {
  try {
    const cfg = getTradeConfig();
    const hasWallet = loadKeypairSafe() != null;
    if (cfg.mode === "live" && hasWallet) {
      return NextResponse.json(
        {
          error:
            "Cannot reset when running LIVE with a real wallet — real trading history is protected.",
        },
        { status: 403 },
      );
    }
    await clearAllPositions();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[/api/portfolio DELETE]", error);
    const message =
      error instanceof Error ? error.message : "Failed to reset portfolio";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// A malformed secret key must not 500 the whole dashboard — treat as no wallet.
function loadKeypairSafe() {
  try {
    return loadKeypair();
  } catch {
    return null;
  }
}
