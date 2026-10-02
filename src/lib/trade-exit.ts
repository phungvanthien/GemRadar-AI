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

import type { Position } from "./position-store";
import {
  filledTierIds,
  getOpenPositions,
  recordSellFill,
  updatePeak,
  needsReconcile,
  reconcileFromChain,
  getTotalRealizedPnlSol,
  computeUnrealizedPnlSol,
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
import { sell } from "./jupiter-swap";
import {
  getConnection,
  loadKeypair,
  getTokenBalance,
} from "./trade-wallet";

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
    if (price == null) continue; // no price this tick — hold

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
      await recordSellFill(
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
          reason: action.reason,
        },
        {},
        now,
      );
      console.error(`[trade-exit] sell failed for ${pos.symbol}:`, e);
    }
  }
}
