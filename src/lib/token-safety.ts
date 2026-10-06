// token-safety.ts — pre-entry token risk gate (POST-MORTEM P0).
//
// spam-filter.ts judges the SIGNAL (bot X accounts, fake Telegram groups). This
// judges the TOKEN ITSELF: is it liquid enough to exit, is the mint renounced,
// is the LP locked, is supply concentrated, is it old enough to have survived the
// snipe-and-rug window. The first live run had none of this — CATGPT rugged for
// -100% and SIP sold at -99.5% because nothing gated the entry.
//
// PURE and chain-free (mirrors decideSells / evaluateEntryGate / assert*): it
// reads the on-chain metrics the gem pipeline already computed and returns a
// verdict. No network, no fs — unit-testable with a synthetic metrics object.
//
// Design (same as spam-filter.ts): layered, conservative, transparent.
//  - A few HARD rejects for things that make a safe exit impossible (mint not
//    renounced, liquidity below the floor that lets a stop-loss fill).
//  - Everything else accumulates a graded rugRisk score; the position is only
//    rejected when that score crosses a threshold, so one weak signal on an
//    otherwise-healthy token doesn't block it.

import type { SolanaOnChainMetrics } from "./types";
import type { TradeConfig } from "./trade-config";
import { getTradeConfig } from "./trade-config";

export interface TokenSafetyVerdict {
  // True when the token must NOT be entered.
  rejected: boolean;
  // 0 = clean, 100 = maximally risky. Drives dynamic sizing even when accepted.
  rugRisk: number;
  // Human-readable reasons for each deduction / hard reject (UI + AI context).
  flags: string[];
}

// Resolve the aggregate USD liquidity we trust most: RugCheck's figure. null
// when unavailable — the caller's floor check then fails closed.
function liquidityUsd(m: SolanaOnChainMetrics): number | null {
  return m.rugcheck?.totalMarketLiquidity ?? null;
}

// Evaluate a token for rug/illiquidity risk before entry. Pure.
export function evaluateTokenSafety(
  m: SolanaOnChainMetrics,
  cfg: TradeConfig = getTradeConfig(),
): TokenSafetyVerdict {
  const flags: string[] = [];
  let rugRisk = 0;
  let rejected = false;

  const hardReject = (flag: string) => {
    flags.push(flag);
    rejected = true;
  };

  // ── HARD rejects: a safe exit is impossible, so never enter ────────────

  // 1. Mint authority still live: the creator can mint unlimited supply and
  //    dilute holders to zero. This is the CATGPT failure mode. Fail CLOSED on
  //    the authority flags — they're always present on SolanaOnChainMetrics.
  if (!m.mintAuthorityRevoked) {
    hardReject("mint authority NOT revoked (infinite-mint rug risk)");
  }

  // 2. Liquidity floor: below this, a stop-loss can't fill and a rug drains the
  //    pool before the exit loop can react. null liquidity fails closed only
  //    when a floor is configured.
  const liq = liquidityUsd(m);
  if (cfg.minLiquidityUsd > 0) {
    if (liq == null) {
      hardReject("liquidity unknown (fail-closed below floor)");
    } else if (liq < cfg.minLiquidityUsd) {
      hardReject(`liquidity $${Math.round(liq)} < floor $${cfg.minLiquidityUsd}`);
    }
  }

  // 3. Token age: a few minutes of survival filters most snipe-and-rug launches.
  //    null age (unknown) is treated as a soft risk, not a hard reject.
  if (m.ageSeconds != null) {
    if (m.ageSeconds < cfg.minTokenAgeSeconds) {
      hardReject(
        `token only ${Math.round(m.ageSeconds)}s old < ${cfg.minTokenAgeSeconds}s floor`,
      );
    }
  } else {
    flags.push("token age unknown");
    rugRisk += 15;
  }

  // 4. Holder concentration: one wallet holding most of the supply can dump the
  //    whole float at once. Hard reject above the single-holder ceiling.
  if (m.largestHolderShare > cfg.maxTopHolderShare) {
    hardReject(
      `top holder ${(m.largestHolderShare * 100).toFixed(0)}% > ${(cfg.maxTopHolderShare * 100).toFixed(0)}% ceiling`,
    );
  }
  if (m.holderConcentrationTop10 > cfg.maxTop10Share) {
    hardReject(
      `top-10 hold ${(m.holderConcentrationTop10 * 100).toFixed(0)}% > ${(cfg.maxTop10Share * 100).toFixed(0)}% ceiling`,
    );
  }

  // ── Graded signals: accumulate rugRisk, reject only past the threshold ──

  // 5. Freeze authority still live: creator can freeze your tokens so you can't
  //    sell. Serious, but not an auto-rug the way infinite mint is — graded.
  if (!m.freezeAuthorityRevoked) {
    flags.push("freeze authority NOT revoked");
    rugRisk += 30;
  }

  // 6. LP lock: unlocked liquidity can be pulled at will. Only RugCheck reports
  //    it; absent data is a mild unknown, present-and-low is a real risk.
  const lpLocked = m.rugcheck?.lpLockedPct;
  if (lpLocked == null) {
    flags.push("LP lock unknown");
    rugRisk += 10;
  } else if (lpLocked < 50) {
    flags.push(`LP only ${Math.round(lpLocked)}% locked`);
    rugRisk += 25;
  } else if (lpLocked < 90) {
    flags.push(`LP ${Math.round(lpLocked)}% locked (partial)`);
    rugRisk += 10;
  }

  // 7. Near-ceiling holder concentration (didn't hard-reject but still skewed).
  if (m.largestHolderShare > cfg.maxTopHolderShare / 2) {
    flags.push(`top holder ${(m.largestHolderShare * 100).toFixed(0)}% (elevated)`);
    rugRisk += 15;
  }
  if (m.holderConcentrationTop10 > cfg.maxTop10Share / 2) {
    flags.push(`top-10 ${(m.holderConcentrationTop10 * 100).toFixed(0)}% (elevated)`);
    rugRisk += 10;
  }

  // 8. Holder count: too few holders means insider-held / illiquid. null data
  //    (unknown) is a mild unknown rather than a reject.
  if (cfg.minHolderCount > 0) {
    if (m.holderCount == null) {
      flags.push("holder count unknown");
      rugRisk += 10;
    } else if (m.holderCount < cfg.minHolderCount) {
      flags.push(`only ${m.holderCount} holders < ${cfg.minHolderCount}`);
      rugRisk += 20;
    }
  }

  // 9. Insider networks: coordinated accounts that often dump together.
  const insiders = m.rugcheck?.insiderNetworkCount ?? 0;
  if (insiders > 0) {
    flags.push(`${insiders} insider network(s) detected`);
    rugRisk += Math.min(insiders * 15, 40);
  }

  // 10. RugCheck's own aggregate risk score (0-100, higher = riskier).
  const rcScore = m.rugcheck?.scoreNormalised;
  if (typeof rcScore === "number" && rcScore > 0) {
    // Fold a fraction of RugCheck's view in without letting it dominate.
    rugRisk += Math.round(rcScore * 0.3);
  }

  rugRisk = Math.max(0, Math.min(100, rugRisk));

  if (!rejected && rugRisk >= cfg.maxRugRiskScore) {
    flags.push(`rug-risk ${rugRisk} >= ${cfg.maxRugRiskScore} threshold`);
    rejected = true;
  }

  return { rejected, rugRisk, flags };
}
