// Gem scoring for freshly-minted Solana tokens.
//
// Implements the weighted model from gem-score.md: Security 35%, Volume &
// Liquidity 25%, Social & Smart Money 20%, Holder Distribution 20%. Because some
// inputs are not yet available (real 24h volume, smart-money tracking), each
// category reports whether it is `covered`; the total is re-normalized over only
// the covered categories so the score never silently pretends to know what it
// doesn't. `coverage` (0-1) tells the caller how much of the model backed the score.

import type { SolanaOnChainMetrics } from "./types";

// Price/liquidity from Jupiter, filled in Phase 2. Kept optional so Phase 1
// scores work with on-chain + RugCheck alone.
export interface JupiterMarketData {
  usdPrice: number | null;
  liquidity: number | null; // aggregate USD liquidity per Jupiter
  priceChange24h: number | null; // percent
}

// Social signals: Telegram community (from the Phase 4 worker) and/or X presence
// (from src/lib/x.ts). Either may be absent; the social category is covered when
// at least one is present, and combines whichever it has.
export interface SocialSignals {
  socialScore?: number; // 0-100, Telegram community score (worker)
  xScore?: number; // 0-100, X/Twitter presence score
}

// Real trading data from DexScreener: 24h volume + buy/sell counts. Fills the
// volume gap Jupiter v3 couldn't. Absent => money-flow not covered and the
// liquidity score falls back to depth-only.
export interface DexMarketData {
  volume24h: number | null;
  buys24h: number | null;
  sells24h: number | null;
  liquidityUsd: number | null;
  marketCap: number | null;
}

export interface CategoryScore {
  score: number; // 0-100
  covered: boolean; // false => excluded from the weighted total
  notes: string[]; // short green/red flags for UI + AI context
}

export interface GemScoreBreakdown {
  security: CategoryScore;
  liquidity: CategoryScore;
  moneyFlow: CategoryScore;
  social: CategoryScore;
  distribution: CategoryScore;
  total: number; // 0-100, re-normalized over covered categories
  coverage: number; // 0-1, share of model weight that was covered
}

// Weights from gem-score.md. Its "Social & Smart Money 20%" is split here into
// Social (Telegram community, 10%) and Money Flow (buy/sell pressure + insider
// concentration, 10%) — the two halves that group described.
const WEIGHTS = {
  security: 0.35,
  liquidity: 0.25,
  moneyFlow: 0.1,
  social: 0.1,
  distribution: 0.2,
} as const;

const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));

// --- Security & Safety (35%) ---
// Green: mint/freeze revoked, LP locked/burned high, low RugCheck risk, no honeypot.
// Red: authorities still live, thin/absent LP lock, high RugCheck score, risk flags.
function scoreSecurity(onChain: SolanaOnChainMetrics): CategoryScore {
  const notes: string[] = [];
  let score = 0;

  // Authorities: 40 points total (each is a hard rug lever if still live).
  if (onChain.mintAuthorityRevoked) {
    score += 20;
    notes.push("mint revoked");
  } else {
    notes.push("mint authority LIVE");
  }
  if (onChain.freezeAuthorityRevoked) {
    score += 20;
    notes.push("freeze revoked");
  } else {
    notes.push("freeze authority LIVE");
  }

  const rc = onChain.rugcheck;

  // LP lock: 30 points, scaled by locked %. gem-score.md wants ~100% burned/locked.
  if (rc && typeof rc.lpLockedPct === "number") {
    const pct = clamp(rc.lpLockedPct, 0, 100);
    score += (pct / 100) * 30;
    if (pct >= 90) notes.push("LP locked/burned");
    else if (pct < 20) notes.push(`LP lock only ${pct.toFixed(0)}%`);
  } else {
    // Unknown LP lock — award nothing, flag it (conservative).
    notes.push("LP lock unknown");
  }

  // RugCheck normalized risk: 30 points, inverted (0 risk => full, 100 => none).
  if (rc && typeof rc.scoreNormalised === "number") {
    score += (1 - clamp(rc.scoreNormalised, 0, 100) / 100) * 30;
    if (rc.scoreNormalised >= 60) notes.push(`high risk ${rc.scoreNormalised}`);
    if (rc.topRisks && rc.topRisks.length > 0) {
      notes.push(...rc.topRisks.slice(0, 2));
    }
  } else {
    // No RugCheck score — give partial credit so a token isn't punished purely
    // for missing third-party data, but flag the gap.
    score += 15;
    notes.push("no RugCheck score");
  }

  return { score: clamp(score), covered: true, notes };
}

// --- Holder Distribution (20%) ---
// gem-score.md: top10 (ex-LP/burn) < 15% good, > 20% bad; single wallet > 10% bad;
// more unique holders is better (>500-1000 healthy).
function scoreDistribution(onChain: SolanaOnChainMetrics): CategoryScore {
  const notes: string[] = [];
  let score = 0;

  // Top-10 concentration: 45 points. share is 0-1.
  const top10 = onChain.holderConcentrationTop10;
  if (top10 <= 0.15) {
    score += 45;
    notes.push(`top10 ${(top10 * 100).toFixed(0)}%`);
  } else if (top10 >= 0.5) {
    score += 0;
    notes.push(`top10 ${(top10 * 100).toFixed(0)}% (very concentrated)`);
  } else {
    // Linear falloff between 15% (full) and 50% (zero).
    score += 45 * (1 - (top10 - 0.15) / (0.5 - 0.15));
    notes.push(`top10 ${(top10 * 100).toFixed(0)}%`);
  }

  // Largest single holder: 30 points. gem-score.md flags > 10%.
  const largest = onChain.largestHolderShare;
  if (largest <= 0.1) {
    score += 30;
  } else if (largest >= 0.4) {
    score += 0;
    notes.push(`largest holder ${(largest * 100).toFixed(0)}%`);
  } else {
    score += 30 * (1 - (largest - 0.1) / (0.4 - 0.1));
    notes.push(`largest holder ${(largest * 100).toFixed(0)}%`);
  }

  // Holder count: 25 points, saturating at ~1000 holders.
  const count = onChain.holderCount;
  if (typeof count === "number") {
    score += clamp((count / 1000) * 25, 0, 25);
    notes.push(`${count.toLocaleString()} holders`);
  } else {
    // Holder count unavailable from the node — give partial credit, flag it.
    score += 12.5;
    notes.push("holder count unknown");
  }

  return { score: clamp(score), covered: true, notes };
}

// --- Volume & Liquidity (25%) ---
// Phase 1: only liquidity is known (RugCheck totalMarketLiquidity, or Jupiter in
// Phase 2). Real 24h volume / buy-sell ratio is not available yet, so we score on
// liquidity depth alone and flag the gap. Category is still `covered` because
// liquidity IS a real, load-bearing signal on its own.
function scoreLiquidity(
  onChain: SolanaOnChainMetrics,
  jup?: JupiterMarketData | null,
  dex?: DexMarketData | null,
): CategoryScore {
  const notes: string[] = [];

  // Prefer DexScreener liquidity, then Jupiter, then RugCheck.
  const liq =
    (dex && typeof dex.liquidityUsd === "number" ? dex.liquidityUsd : null) ??
    (jup && typeof jup.liquidity === "number" ? jup.liquidity : null) ??
    onChain.rugcheck?.totalMarketLiquidity ??
    null;

  if (liq === null) {
    return {
      score: 0,
      covered: false,
      notes: ["no liquidity data"],
    };
  }

  // Depth is 70% of the score; real 24h volume turnover is the other 30% when
  // DexScreener has it. gem-score.md: < $1k LP red, > $10k healthy; Volume/MCap
  // > 1.5 is a strong-interest green flag.
  let depth: number;
  if (liq < 1_000) {
    depth = (liq / 1_000) * 20;
    notes.push(`thin LP $${Math.round(liq).toLocaleString()}`);
  } else if (liq < 10_000) {
    depth = 20 + ((liq - 1_000) / 9_000) * 40;
    notes.push(`LP $${Math.round(liq).toLocaleString()}`);
  } else if (liq < 50_000) {
    depth = 60 + ((liq - 10_000) / 40_000) * 25;
    notes.push(`LP $${Math.round(liq).toLocaleString()}`);
  } else {
    depth = clamp(85 + ((liq - 50_000) / 50_000) * 15, 0, 100);
    notes.push(`deep LP $${Math.round(liq).toLocaleString()}`);
  }

  const vol = dex?.volume24h ?? null;
  const mcap = dex?.marketCap ?? null;
  let score: number;

  if (vol != null) {
    notes.push(`vol24h $${Math.round(vol).toLocaleString()}`);
    // Turnover = volume / market cap. gem-score.md flags > 1.5 as strong demand.
    let turnover = 0; // 0-100
    if (mcap && mcap > 0) {
      const ratio = vol / mcap;
      turnover = clamp((ratio / 1.5) * 100, 0, 100);
      notes.push(`turnover ${ratio.toFixed(2)}×`);
    } else {
      // No mcap — score turnover off raw volume, saturating around $500k/24h.
      turnover = clamp((vol / 500_000) * 100, 0, 100);
    }
    score = depth * 0.7 + turnover * 0.3;
  } else {
    // No real volume — depth only, and flag it.
    score = depth;
    notes.push("volume 24h N/A");
  }

  // 24h price change as a weak momentum nudge (±10 points).
  const change = dex?.volume24h != null ? null : jup?.priceChange24h ?? null;
  if (change != null) {
    score = clamp(score + (clamp(change, -50, 50) / 50) * 10);
    notes.push(`24h ${change >= 0 ? "+" : ""}${change.toFixed(1)}%`);
  }

  return { score: clamp(score), covered: true, notes };
}

// --- Money Flow (10%) — the "smart money" half of gem-score.md's Social & Smart
// Money group, built from FREE data only: DexScreener buy/sell pressure plus
// RugCheck insider concentration. This is NOT wallet win-rate tracking (no free
// source gives that reliably); it's a buy-pressure + insider-risk proxy, named
// honestly. Not covered when neither signal is available.
function scoreMoneyFlow(
  onChain: SolanaOnChainMetrics,
  dex?: DexMarketData | null,
): CategoryScore {
  const notes: string[] = [];
  let parts = 0;
  let score = 0;

  // Buy/sell pressure: 60% weight. gem-score.md likes > 60% buys.
  if (dex && dex.buys24h != null && dex.sells24h != null) {
    const total = dex.buys24h + dex.sells24h;
    if (total > 0) {
      const buyRatio = dex.buys24h / total;
      score += clamp(buyRatio * 100) * 0.6;
      notes.push(`${Math.round(buyRatio * 100)}% buys`);
      parts += 0.6;
    }
  }

  // Insider concentration (inverse): 40% weight. More insider networks / insider
  // holders = worse. RugCheck's insiderNetworkCount is the signal we already have.
  const insiderCount = onChain.rugcheck?.insiderNetworkCount;
  if (typeof insiderCount === "number") {
    // 0 networks = full marks; 5+ = zero.
    const insiderScore = clamp((1 - Math.min(insiderCount, 5) / 5) * 100);
    score += insiderScore * 0.4;
    if (insiderCount > 0) notes.push(`${insiderCount} insider network${insiderCount === 1 ? "" : "s"}`);
    else notes.push("no insider networks");
    parts += 0.4;
  }

  if (parts === 0) {
    return { score: 0, covered: false, notes: ["no money-flow data"] };
  }

  // Re-normalize over the parts that had data.
  return { score: clamp(score / parts), covered: true, notes };
}

// --- Social (10%) ---
// Combines the Telegram community score (Phase 4 worker) and the X/Twitter
// presence score (src/lib/x.ts). When both are present they're averaged; when
// only one is, that one stands. Not covered when neither is available.
function scoreSocial(social?: SocialSignals | null): CategoryScore {
  const notes: string[] = [];
  const scores: number[] = [];

  if (social && typeof social.socialScore === "number") {
    scores.push(clamp(social.socialScore));
    notes.push(`TG ${Math.round(social.socialScore)}`);
  }
  if (social && typeof social.xScore === "number") {
    scores.push(clamp(social.xScore));
    notes.push(`X ${Math.round(social.xScore)}`);
  }

  if (scores.length === 0) {
    return { score: 0, covered: false, notes: ["social not tracked yet"] };
  }

  const avg = scores.reduce((s, n) => s + n, 0) / scores.length;
  return { score: clamp(avg), covered: true, notes };
}

export interface GemScoreInput {
  onChain: SolanaOnChainMetrics;
  jupiter?: JupiterMarketData | null;
  dex?: DexMarketData | null;
  social?: SocialSignals | null;
}

// Combine the five categories into a 0-100 score, re-normalizing over only the
// categories that had data. `coverage` reports how much of the original model
// weight was actually backed by data.
export function computeGemScore(input: GemScoreInput): GemScoreBreakdown {
  const security = scoreSecurity(input.onChain);
  const distribution = scoreDistribution(input.onChain);
  const liquidity = scoreLiquidity(input.onChain, input.jupiter, input.dex);
  const moneyFlow = scoreMoneyFlow(input.onChain, input.dex);
  const social = scoreSocial(input.social);

  const categories: Array<[keyof typeof WEIGHTS, CategoryScore]> = [
    ["security", security],
    ["liquidity", liquidity],
    ["moneyFlow", moneyFlow],
    ["social", social],
    ["distribution", distribution],
  ];

  let weightedSum = 0;
  let coveredWeight = 0;
  for (const [key, cat] of categories) {
    if (!cat.covered) continue;
    weightedSum += cat.score * WEIGHTS[key];
    coveredWeight += WEIGHTS[key];
  }

  const total = coveredWeight > 0 ? weightedSum / coveredWeight : 0;

  return {
    security,
    liquidity,
    moneyFlow,
    social,
    distribution,
    total: Math.round(total),
    coverage: Number(coveredWeight.toFixed(2)),
  };
}
