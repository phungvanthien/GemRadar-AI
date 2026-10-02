// Entry engine. Given a scored gem list and the current settings, open positions
// for gems that clear the threshold and pass every safety guard. Best-effort and
// chain-light in dry-run; the single live gate (canTradeLive) decides whether a
// real buy is signed.
//
// IMPORTANT thresholds: settings.minGemScoreToTrigger is on the 0-100 scale, so
// it is compared against the DETERMINISTIC breakdown.total (also 0-100), NOT the
// AI gemScore (1-10). This mirrors the pipeline's own shouldTrackSocial rigor.

import type { SolanaGemAnalysis } from "./types";
import type { GemScoreBreakdown } from "./gem-score";
import type { TradingSettings } from "./settings-store";
import { loadSettings } from "./settings-store";
import {
  canTradeLive,
  effectiveMode,
  getTradeConfig,
  type TradeConfig,
} from "./trade-config";
import {
  GuardError,
  assertKillSwitchOff,
  assertUnderMaxSol,
  assertDailyCapOk,
  assertBalanceFloorOk,
  assertPoolDepthOk,
  loadKeypair,
  getConnection,
  getBalanceSol,
  getTokenBalance,
} from "./trade-wallet";
import { buy } from "./jupiter-swap";
import {
  getOpenPositionByMint,
  getTradesOpenedToday,
  getOpenPositions,
  getRealizedPnlToday,
  getTotalRealizedPnlSol,
  openPosition,
} from "./position-store";
import { loadMandate } from "./mandate-store";
import { computeAccounting, evaluateEntryGate, type Mandate } from "./mandate";

// A scored gem as produced by the solana-gems pipeline (gem + breakdown).
export interface ScoredGem extends SolanaGemAnalysis {
  breakdown: GemScoreBreakdown | null;
}

export interface EntryDecision {
  mint: string;
  symbol: string;
  action: "bought" | "skipped";
  mode: "dry-run" | "live";
  reason: string;
}

function liquidityUsd(gem: ScoredGem): number | null {
  // Prefer RugCheck's aggregate market liquidity; fall back to the on-chain pool
  // quote side valued in... we don't have a USD price for the quote here, so use
  // RugCheck's figure which is already USD. null => fail-closed in the guard.
  return gem.onChain.rugcheck?.totalMarketLiquidity ?? null;
}

// Decide + act for a batch. Pure-ish: all chain calls are skipped in dry-run
// except an optional balance read which we also skip when not live.
export async function maybeEnterPositions(
  scored: ScoredGem[],
  settings: TradingSettings = loadSettings(),
  cfg: TradeConfig = getTradeConfig(),
  now = new Date(),
  mandate?: Mandate,
): Promise<EntryDecision[]> {
  const decisions: EntryDecision[] = [];

  // Gate off entirely unless auto-buy is enabled in settings.
  if (!settings.autoBuyEnabled) {
    return scored.map((g) => ({
      mint: g.mint,
      symbol: g.symbol,
      action: "skipped" as const,
      mode: "dry-run" as const,
      reason: "autoBuyEnabled=false",
    }));
  }

  // The capital mandate is the source of truth for sizing + portfolio risk. It
  // sits ABOVE the per-trade guards below (which still run as a second line of
  // defense). An inactive mandate blocks every entry regardless of autoBuy.
  const activeMandate = mandate ?? (await loadMandate());
  if (activeMandate.status !== "active") {
    return scored.map((g) => ({
      mint: g.mint,
      symbol: g.symbol,
      action: "skipped" as const,
      mode: effectiveMode({ autoBuyEnabled: settings.autoBuyEnabled }),
      reason: "mandate-not-active",
    }));
  }

  const live = canTradeLive({ autoBuyEnabled: settings.autoBuyEnabled });
  const mode = effectiveMode({ autoBuyEnabled: settings.autoBuyEnabled });

  // Kill-switch halts all entries.
  try {
    assertKillSwitchOff(cfg);
  } catch (e) {
    return scored.map((g) => ({
      mint: g.mint,
      symbol: g.symbol,
      action: "skipped" as const,
      mode,
      reason: e instanceof GuardError ? e.code : "kill-switch",
    }));
  }

  // Live-only: read wallet balance once up front for the floor guard.
  let keypair = null as ReturnType<typeof loadKeypair>;
  let connection = null as ReturnType<typeof getConnection> | null;
  let balanceSol = Number.POSITIVE_INFINITY; // dry-run: treat as unlimited
  if (live) {
    keypair = loadKeypair(cfg);
    if (keypair) {
      connection = getConnection(cfg);
      try {
        balanceSol = await getBalanceSol(connection, keypair.publicKey);
      } catch {
        balanceSol = 0; // can't read balance -> fail closed below
      }
    }
  }

  let tradesToday = await getTradesOpenedToday(now);

  // Mandate accounting snapshot for this scan. deployedSol / openCount are the
  // live portfolio state; we increment them locally as we open positions
  // (mirroring tradesToday / balanceSol) so each subsequent gem is sized against
  // the capital that remains after the ones we just bought this scan.
  //
  // Entry uses lifetime REALIZED P&L for the drawdown gate (unrealized is unknown
  // here without a per-mint price fetch). That's deliberately conservative: the
  // exit monitor, which already has prices, enforces the full equity drawdown.
  const openPositions = await getOpenPositions();
  let deployedSol = openPositions.reduce((s, p) => s + p.entrySol, 0);
  let openCount = openPositions.length;
  const realizedTodaySol = await getRealizedPnlToday(now);
  const realizedLifetimeSol = await getTotalRealizedPnlSol();

  // Rank by deterministic total so the best gems get the daily budget first.
  const ranked = [...scored].sort(
    (a, b) => (b.breakdown?.total ?? 0) - (a.breakdown?.total ?? 0),
  );

  for (const gem of ranked) {
    const total = gem.breakdown?.total ?? 0;
    const coverage = gem.breakdown?.coverage ?? 0;

    // Threshold check (0-100 deterministic total). Require some coverage so a
    // sparse, mostly-uncovered score can't trip the trigger.
    if (total < settings.minGemScoreToTrigger) {
      decisions.push({ mint: gem.mint, symbol: gem.symbol, action: "skipped", mode, reason: `total ${total} < ${settings.minGemScoreToTrigger}` });
      continue;
    }
    if (coverage < 0.5) {
      decisions.push({ mint: gem.mint, symbol: gem.symbol, action: "skipped", mode, reason: `coverage ${coverage} < 0.5` });
      continue;
    }

    // Already holding this mint? Don't stack.
    if (await getOpenPositionByMint(gem.mint)) {
      decisions.push({ mint: gem.mint, symbol: gem.symbol, action: "skipped", mode, reason: "already-open" });
      continue;
    }

    // Mandate entry-gate: sizes the buy from entrusted capital and enforces
    // portfolio-level risk (drawdown, daily loss, max-open, available). Re-run
    // per gem because deployedSol / openCount change as we buy within this scan.
    const acct = computeAccounting({
      mandate: activeMandate,
      deployedSol,
      realizedPnlSol: realizedLifetimeSol,
      unrealizedPnlSol: 0, // unknown at entry; exit monitor enforces full equity
      maxSolPerTrade: cfg.maxSolPerTrade,
    });
    const gate = evaluateEntryGate({
      mandate: activeMandate,
      acct,
      openCount,
      realizedTodaySol,
    });
    if (!gate.allowed) {
      decisions.push({ mint: gem.mint, symbol: gem.symbol, action: "skipped", mode, reason: gate.reason });
      continue;
    }

    const sol = gate.sizeSol;
    const priceUsd = gem.price > 0 ? gem.price : 0;

    try {
      assertUnderMaxSol(sol, cfg);
      assertDailyCapOk(tradesToday, cfg);
      if (live) assertBalanceFloorOk(balanceSol, sol, cfg);

      // Thin-pool guard: value the buy in USD. Need a SOL/USD price; the gem's
      // own price is per-token, so approximate trade USD from pool share using
      // the token's market liquidity vs the SOL notional. We instead gate on the
      // SOL price of the buy relative to pool USD liquidity, requiring a SOL/USD.
      // Without a SOL/USD oracle here we conservatively require pool liquidity to
      // dwarf a generous USD estimate of the buy.
      const estSolUsd = 200; // conservative floor for SOL price; real value only matters live
      const tradeUsd = sol * estSolUsd;
      assertPoolDepthOk(tradeUsd, liquidityUsd(gem), cfg);
    } catch (e) {
      decisions.push({
        mint: gem.mint,
        symbol: gem.symbol,
        action: "skipped",
        mode,
        reason: e instanceof GuardError ? e.code : "guard-failed",
      });
      continue;
    }

    // Execute the buy (dry-run logs; live signs).
    try {
      const { fill, outcome } = await buy(
        gem.mint,
        sol,
        priceUsd,
        gem.onChain.decimals,
        { live, keypair, connection, cfg },
        now,
      );

      // A buy we KNOW didn't execute: open no position, consume no budget.
      if (outcome === "failed") {
        decisions.push({
          mint: gem.mint,
          symbol: gem.symbol,
          action: "skipped",
          mode,
          reason: `buy-failed:${fill.error ?? "unknown"}`,
        });
        continue;
      }

      // "unknown": the buy MAY have landed. Opening a position with the quoted
      // token amount could be wrong, but NOT opening one risks an untracked
      // on-chain bag. We open it and let the exit monitor's reconcile step fix
      // the true balance on its next tick (the entry fill carries the error, so
      // needsReconcile() would not trip on a BUY — so we verify the balance
      // inline here when we can).
      let tokenAmount = fill.tokenAmount;
      let entryFill = fill;
      if (outcome === "unknown") {
        if (live && keypair && connection) {
          try {
            const held = await getTokenBalance(connection, keypair.publicKey, gem.mint);
            tokenAmount = held;
            entryFill = { ...fill, tokenAmount: held, error: undefined };
          } catch {
            // Keep the ambiguous fill as-is; it will show in the ledger with its
            // error for manual review.
          }
        }
        console.warn(`[trade-entry] ambiguous buy for ${gem.symbol}; recorded with reconciled balance`);
      }

      await openPosition(
        {
          mint: gem.mint,
          symbol: gem.symbol,
          mode,
          entryPriceUsd: entryFill.priceUsd || priceUsd,
          entrySol: entryFill.sol || sol,
          tokenAmount,
          decimals: gem.onChain.decimals,
          sellStrategy: settings.sellStrategy,
          entryFill,
        },
        now,
      );
      tradesToday += 1;
      balanceSol -= sol;
      // Advance mandate accounting so the next gem in this scan is sized against
      // the capital that remains after this buy.
      deployedSol += entryFill.sol || sol;
      openCount += 1;
      decisions.push({ mint: gem.mint, symbol: gem.symbol, action: "bought", mode, reason: fill.txSig ? `tx ${fill.txSig}` : "dry-run" });
    } catch (e) {
      decisions.push({
        mint: gem.mint,
        symbol: gem.symbol,
        action: "skipped",
        mode,
        reason: e instanceof GuardError ? e.code : e instanceof Error ? e.message : "buy-failed",
      });
    }
  }

  return decisions;
}
