// Exit engine. Each monitor tick fetches current prices for open positions and
// decides what fraction (if any) to sell, honoring the position's SNAPSHOTTED
// sellStrategy. The decision logic (decideSells) is PURE and chain-free so the
// whole state machine is unit-testable with an injected price; executeExits wires
// it to the swap module + store.
//
// Priority order (first match wins per position, but stop-loss/kill always win):
//   kill-switch > stop-loss > max-hold > mode take-profit (ladder/single/trailing)
// The manual-hold "moon bag" is never auto-sold: cumulative sold is clamped to
// (100 - manualHoldPercent).

import type { Position, Fill } from "./position-store";
import {
  filledTierIds,
  getOpenPositions,
  recordSellFill,
  updatePeak,
  needsReconcile,
  reconcileFromChain,
  getTotalRealizedPnlSol,
  computeUnrealizedPnlSol,
  consecutiveSellFails,
  isRugSellSignal,
  writeOffPosition,
} from "./position-store";
import { loadMandate } from "./mandate-store";
import { computeAccounting, shouldForceLiquidate } from "./mandate";
import { getJupiterPrices } from "./jupiter";
import { getDexScreenerData } from "./dexscreener";
import {
  canTradeLive,
  effectiveMode,
  getTradeConfig,
  type TradeConfig,
} from "./trade-config";
import { loadSettings } from "./settings-store";
import { sell, quotePriceUsd } from "./jupiter-swap";
import {
  getConnection,
  loadKeypair,
  getTokenBalance,
  GuardError,
} from "./trade-wallet";

// Wrapped-SOL mint — the SOL/USD reference for the price-gap fallback. Always
// present in Jupiter Price v3, unlike the thin memecoins that trigger a gap.
const WSOL_MINT = "So11111111111111111111111111111111111111112";

// Extract a stable error code from a thrown value for the fill ledger. A
// GuardError carries its own `code` (e.g. "quote-no-route", "price-impact",
// "quote-http"); anything else is an unclassified failure.
function errorCodeOf(e: unknown): string {
  return e instanceof GuardError ? e.code : "exception";
}

export interface SellAction {
  // % of the ORIGINAL position to sell on this tick (already clamped to the
  // sellable ceiling and to what remains).
  pct: number;
  reason: string; // e.g. "ladder-t2" | "stop-loss" | "max-hold" | "trailing" | "single" | "kill-switch"
  // Whether, after this sell, the position should be force-closed (e.g. stop-loss
  // dumps everything remaining).
  closeAfter: boolean;
  // Updated trailing-armed latch to persist (true once peak crosses activation).
  trailingArmed: boolean;
}

export interface DecideContext {
  currentPriceUsd: number;
  now: Date;
  killSwitch: boolean;
}

// Consecutive genuine "can't be sold" signals after which a position is written
// off as a rugpull (no swap route / price impact too high / on-chain reject).
// consecutiveSellFails already excludes transient infra failures, so three such
// signals in a row is a token that genuinely can't be sold, not a Jupiter hiccup.
export const RUGPULL_WRITEOFF_FAILS = 3;

// The most recent sell attempt in the ledger, ignoring reconcile bookkeeping.
// Used as a final guard before write-off: the LAST attempt must itself be a rug
// signal, so a transient infra failure landing after an old rug run can't trip a
// stale write-off.
function lastSellAttempt(pos: Position): Fill | null {
  for (let i = pos.fills.length - 1; i >= 0; i--) {
    const f = pos.fills[i];
    if (f.kind !== "sell") continue;
    if (f.reason === "reconcile") continue;
    return f;
  }
  return null;
}

// If `pos` has hit the rugpull fail threshold, write it off and log it. Returns
// true when a write-off happened (the caller should stop managing the position).
//
// Two guards protect against the false-positive rugpull that closes a healthy
// position (token still in the wallet, just temporarily unsellable):
//  1. consecutiveSellFails only counts genuine rug signals, never infra noise.
//  2. the MOST RECENT attempt must itself be a rug signal — if the latest tick
//     failed for a transient reason, we hold and retry rather than write off.
async function maybeWriteOffRugpull(pos: Position, now: Date): Promise<boolean> {
  if (consecutiveSellFails(pos) < RUGPULL_WRITEOFF_FAILS) return false;

  const last = lastSellAttempt(pos);
  if (last && !isRugSellSignal(last)) {
    console.warn(
      `[trade-exit] write-off DEFERRED for ${pos.symbol}: ${RUGPULL_WRITEOFF_FAILS}+ rug ` +
        `signals but latest sell failed transiently (${last.errorCode ?? "?"}) — retrying`,
    );
    return false;
  }

  const remainingPct = Math.max(0, 100 - pos.soldPct);
  const lostSol = pos.entrySol * (remainingPct / 100);
  const off = await writeOffPosition(pos.id, "rugpull", now);
  if (off) {
    console.warn(
      `[trade-exit] WRITE-OFF ${off.symbol} after ${RUGPULL_WRITEOFF_FAILS} unsellable sells ` +
        `(rugpull) — booked -${lostSol.toFixed(4)} SOL loss, slot freed`,
    );
  }
  return off != null;
}

// PURE. Decide the sell for one position this tick. Returns null for "hold".
export function decideSells(pos: Position, ctx: DecideContext): SellAction | null {
  const s = pos.sellStrategy;
  const entry = pos.entryPriceUsd;
  const price = ctx.currentPriceUsd;
  const peak = Math.max(pos.peakPriceUsd, price);

  // Coerce defensively: a snapshot missing manualHoldPercent/soldPct must not
  // poison the ceiling math into NaN (which would silently disable all sells).
  const moonBag = Number.isFinite(s.manualHoldPercent) ? s.manualHoldPercent : 0;
  const soldPct = Number.isFinite(pos.soldPct) ? pos.soldPct : 0;
  const sellableCeiling = Math.max(0, 100 - moonBag);
  const remainingSellable = Math.max(0, sellableCeiling - soldPct);

  // Compute/propagate the trailing-armed latch regardless of which branch fires.
  const trailingArmed =
    pos.trailingArmed || (s.trailingActivateMultiplier > 0 && peak >= entry * s.trailingActivateMultiplier);

  const clamp = (pct: number) => Math.min(pct, remainingSellable);

  // Nothing left to sell (only the moon bag remains).
  if (remainingSellable <= 1e-9) return null;
  if (entry <= 0) return null;

  // 1) Kill-switch: liquidate everything sellable.
  if (ctx.killSwitch) {
    return { pct: remainingSellable, reason: "kill-switch", closeAfter: true, trailingArmed };
  }

  // 2) Stop-loss (all modes when > 0): dump everything sellable.
  if (s.stopLossPercent > 0 && price <= entry * (1 - s.stopLossPercent / 100)) {
    return { pct: remainingSellable, reason: "stop-loss", closeAfter: true, trailingArmed };
  }

  // 3) Max-hold (all modes when > 0): sell the remainder (keep the moon bag).
  if (s.maxHoldMinutes > 0) {
    const heldMs = ctx.now.getTime() - new Date(pos.entryTime).getTime();
    if (heldMs >= s.maxHoldMinutes * 60_000) {
      return { pct: remainingSellable, reason: "max-hold", closeAfter: true, trailingArmed };
    }
  }

  // 4) Mode-specific take-profit.
  switch (s.mode) {
    case "ladder": {
      // Fill the HIGHEST tier reached this tick that hasn't been filled yet.
      // Selling the highest reached tier (and we rely on repeated ticks for the
      // ones below if price keeps climbing) — but to not skip tiers on a gap-up,
      // sum all newly-crossed, unfilled tiers.
      const filled = filledTierIds(pos);
      const crossed = s.tiers
        .filter((t) => !filled.has(t.id) && price >= entry * t.multiplier)
        .sort((a, b) => a.multiplier - b.multiplier);
      if (crossed.length === 0) break;
      // Sell the first unfilled crossed tier this tick (one tier per tick keeps
      // each fill individually attributable and idempotent; a gap-up fills the
      // rest on subsequent ticks). Reason carries the tier id for idempotency.
      const tier = crossed[0];
      const pct = clamp(tier.sellPercent);
      if (pct <= 1e-9) return null;
      const closeAfter = soldPct + pct >= sellableCeiling - 1e-9;
      return { pct, reason: `ladder-${tier.id}`, closeAfter, trailingArmed };
    }
    case "single": {
      if (price >= entry * s.singleTargetMultiplier) {
        return { pct: remainingSellable, reason: "single", closeAfter: true, trailingArmed };
      }
      break;
    }
    case "trailing": {
      if (trailingArmed && price <= peak * (1 - s.trailingStopPercent / 100)) {
        return { pct: remainingSellable, reason: "trailing", closeAfter: true, trailingArmed };
      }
      break;
    }
    case "manual":
      // No take-profit; only stop-loss / max-hold / kill-switch apply (above).
      break;
  }

  return null;
}

// Batch price fetch: Jupiter primary, DexScreener fallback for missing mints.
export async function fetchPrices(mints: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (mints.length === 0) return out;
  const jup = await getJupiterPrices(mints);
  for (const [mint, p] of jup) {
    if (p.usdPrice != null) out.set(mint, p.usdPrice);
  }
  const missing = mints.filter((m) => !out.has(m));
  if (missing.length > 0) {
    const dex = await getDexScreenerData(missing);
    for (const [mint, d] of dex) {
      // DexScreener doesn't expose a direct USD price field here; skip unless a
      // future field is added. (Left as the documented fallback hook.)
      void d;
      void mint;
    }
  }
  return out;
}

// Run one monitor tick over all open positions (dry-run logs; live signs).
// forceLiquidateAll forces the kill-switch sell path for every position this
// tick regardless of the mandate state — used by the "stop & withdraw" action to
// close out an entrusted mandate on demand.
export async function monitorPositions(
  cfg: TradeConfig = getTradeConfig(),
  now = new Date(),
  forceLiquidateAll = false,
): Promise<void> {
  const open = await getOpenPositions();
  if (open.length === 0) return;

  const settings = loadSettings();
  const live = canTradeLive({ autoBuyEnabled: settings.autoBuyEnabled });
  const mode = effectiveMode({ autoBuyEnabled: settings.autoBuyEnabled });

  const keypair = live ? loadKeypair(cfg) : null;
  const connection = live && keypair ? getConnection(cfg) : null;

  const prices = await fetchPrices(open.map((p) => p.mint));

  // Price-feed-gap fallback (live only). Jupiter Price API v3 sometimes omits a
  // mint it still has a swap route for — a transient feed gap, NOT a rug. Left
  // unhandled, price==null sends a healthy position down the rugpull-probe path
  // and can get it written off. For each missing mint we derive a price from a
  // real sell quote (token -> WSOL): quotable here == genuinely sellable, which
  // is exactly the distinction we need. Needs a signer to produce a live quote.
  if (live && keypair && connection) {
    const missing = open.filter((p) => prices.get(p.mint) == null);
    if (missing.length > 0) {
      // WSOL is always in Price v3, so this is a reliable SOL/USD reference.
      const solPrice = (await getJupiterPrices([WSOL_MINT])).get(WSOL_MINT)?.usdPrice;
      if (solPrice != null && solPrice > 0) {
        await Promise.all(
          missing.map(async (p) => {
            const sellable = p.tokenAmount * Math.max(0, 100 - p.soldPct) / 100;
            const px = await quotePriceUsd(p.mint, sellable, p.decimals, solPrice, cfg);
            if (px != null && px > 0) {
              prices.set(p.mint, px);
              console.log(
                `[trade-exit] price-gap fallback: ${p.symbol} not in Price v3, ` +
                  `derived $${px.toExponential(3)} from sell quote (still sellable)`,
              );
            }
          }),
        );
      }
    }
  }

  // Mandate drawdown check. Now that prices are in hand, compute FULL equity
  // (realized + unrealized) and ask the mandate whether a breach must liquidate.
  // On a breach in "halt-and-liquidate" mode we force the kill-switch path for
  // every position this tick — reusing decideSells's existing kill-switch branch
  // (dumps everything sellable), so decideSells itself needs no change.
  const mandate = await loadMandate();
  let forceLiquidate = forceLiquidateAll;
  try {
    const deployedSol = open.reduce((s, p) => s + p.entrySol, 0);
    const realizedPnlSol = await getTotalRealizedPnlSol();
    const unrealizedPnlSol = open.reduce((s, p) => {
      const price = prices.get(p.mint);
      return price == null ? s : s + computeUnrealizedPnlSol(p, price);
    }, 0);
    const acct = computeAccounting({
      mandate,
      deployedSol,
      realizedPnlSol,
      unrealizedPnlSol,
      maxSolPerTrade: cfg.maxSolPerTrade,
    });
    const breached = shouldForceLiquidate(mandate, acct);
    forceLiquidate = forceLiquidateAll || breached;
    if (breached) {
      console.warn(
        `[trade-exit] mandate drawdown breach (${acct.drawdownPct.toFixed(1)}% <= -${mandate.maxDrawdownPct}%) ` +
          `— liquidating ${open.length} position(s)`,
      );
    } else if (forceLiquidateAll) {
      console.warn(`[trade-exit] force-liquidate requested — closing ${open.length} position(s)`);
    }
  } catch (e) {
    // A failure computing accounting must never block normal exit management.
    console.error("[trade-exit] mandate accounting failed (continuing without force-liquidate):", e);
  }

  for (let pos of open) {
    // Reconcile FIRST: if the last live sell was ambiguous ("unknown" send),
    // the ledger can't be trusted. Query the real on-chain balance and correct
    // soldPct before deciding or selling again — this is what prevents a
    // double-sell after a confirm timeout. Only possible when live + signer.
    if (needsReconcile(pos) && live && keypair && connection) {
      try {
        const held = await getTokenBalance(connection, keypair.publicKey, pos.mint);
        const fixed = await reconcileFromChain(pos.id, held, now);
        if (fixed) {
          console.log(
            `[trade-exit] reconciled ${pos.symbol}: on-chain ${held} tokens -> soldPct ${fixed.soldPct.toFixed(1)}%`,
          );
          if (fixed.status === "closed") continue; // nothing left to manage
          pos = fixed;
        }
      } catch (e) {
        console.error(`[trade-exit] reconcile failed for ${pos.symbol}, skipping tick:`, e);
        continue; // don't act on an untrusted ledger
      }
    }

    const price = prices.get(pos.mint);
    if (price == null) {
      // No price from any source. For a healthy token this is a transient feed
      // gap — hold. But a rugpulled token also goes priceless AND unsellable, so
      // we probe a sell to let the no-route/price-impact error accrue on the
      // fail-run; once the run hits the threshold the position is written off.
      // Live only: a probe needs a signer to produce a real quote/route error.
      // In dry-run there is no chain to probe, so a priceless position can only
      // be cleared manually (the dashboard write-off button).
      if (!(live && keypair && connection)) continue;
      const probePct = Math.max(0, 100 - pos.soldPct);
      try {
        const probeAmount = pos.tokenAmount * (probePct / 100);
        const { fill } = await sell(
          pos.mint,
          probeAmount,
          pos.decimals,
          probePct,
          0,
          "rugpull-probe",
          { live, keypair, connection, cfg },
          now,
        );
        // A probe that unexpectedly succeeds is a real sell: record it so soldPct
        // advances and the position closes if the sellable amount is exhausted.
        // A non-advancing (errored) fill from the swap layer is recorded too and
        // feeds the fail-run below.
        const updated = await recordSellFill(
          pos.id,
          fill,
          { closeReason: "rugpull-probe" },
          now,
        );
        if (updated) await maybeWriteOffRugpull(updated, now);
        continue;
      } catch (e) {
        const updated = await recordSellFill(
          pos.id,
          {
            time: now.toISOString(),
            kind: "sell",
            pct: probePct,
            priceUsd: 0,
            sol: 0,
            tokenAmount: 0,
            txSig: null,
            dryRun: false,
            error: e instanceof Error ? e.message : "no-price-sell-failed",
            errorCode: errorCodeOf(e),
            reason: "rugpull-probe",
          },
          {},
          now,
        );
        if (updated) await maybeWriteOffRugpull(updated, now);
        continue;
      }
    }

    // Persist the high-water mark + trailing latch BEFORE deciding, so a crash
    // between here and the sell doesn't lose the peak.
    const peak = Math.max(pos.peakPriceUsd, price);
    const armed =
      pos.trailingArmed ||
      (pos.sellStrategy.trailingActivateMultiplier > 0 &&
        peak >= pos.entryPriceUsd * pos.sellStrategy.trailingActivateMultiplier);
    await updatePeak(pos.id, price, armed);

    const action = decideSells(
      { ...pos, peakPriceUsd: peak, trailingArmed: armed },
      { currentPriceUsd: price, now, killSwitch: cfg.killSwitch || forceLiquidate },
    );
    if (!action || action.pct <= 1e-9) continue;

    // Token amount to sell = pct of the ORIGINAL token quantity.
    const tokenAmount = pos.tokenAmount * (action.pct / 100);

    try {
      const { fill } = await sell(
        pos.mint,
        tokenAmount,
        pos.decimals,
        action.pct,
        price,
        action.reason,
        { live, keypair, connection, cfg },
        now,
      );
      await recordSellFill(
        pos.id,
        fill,
        { closeReason: action.reason, forceClose: action.closeAfter },
        now,
      );
      console.log(
        `[trade-exit] ${mode} SELL ${action.pct}% ${pos.symbol} [${action.reason}] ` +
          `@ $${price}`,
      );
    } catch (e) {
      // Record a failed fill for audit; do NOT advance soldPct (handled by the
      // store when fill.error is set). On the next tick we re-evaluate.
      const updated = await recordSellFill(
        pos.id,
        {
          time: now.toISOString(),
          kind: "sell",
          pct: action.pct,
          priceUsd: price,
          sol: 0,
          tokenAmount,
          txSig: null,
          dryRun: !live,
          error: e instanceof Error ? e.message : "sell-failed",
          errorCode: errorCodeOf(e),
          reason: action.reason,
        },
        {},
        now,
      );
      console.error(`[trade-exit] sell failed for ${pos.symbol}:`, e);

      // Rugpull detection: a token that can't be sold produces a run of errored
      // sells (no route / price impact too high). After enough consecutive
      // failures, write the position off as a total loss so its slot + deployed
      // capital are freed and new entries can open again.
      if (updated) await maybeWriteOffRugpull(updated, now);
    }
  }
}
