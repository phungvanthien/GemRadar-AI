// Theo dõi gems AI chấm điểm cao nhưng chưa được mua vào portfolio.
// Worker quét lại mỗi giờ bằng tool deterministic (RugCheck, Jupiter, …) — không
// gọi LLM. Khi điểm hard-score tăng theo chiều hướng tốt, đề xuất AI agent chấm lại.

import { getSocialMonitorConfig } from "./social-config";
import { getOpenPositions } from "./position-store";
import type { EntryDecision } from "./trade-entry";
import {
  upsertWatchCandidates,
  type WatchedGemEntry,
} from "./gem-watchlist-store";
import type { GemScoreBreakdown } from "./gem-score";

const DEFAULT_AI_HIGH_FLOOR = 7;

export function getAiHighScoreFloor(): number {
  const fromEnv = Number(process.env.GEM_AI_HIGH_FLOOR);
  if (Number.isFinite(fromEnv)) {
    return Math.max(1, Math.min(10, Math.floor(fromEnv)));
  }
  return getSocialMonitorConfig().thresholds.minGemScoreAi || DEFAULT_AI_HIGH_FLOOR;
}

export interface ScanGemForAiTrack {
  mint: string;
  symbol: string;
  name: string;
  price?: number;
  gemScore?: number | null;
  riskScore?: number | null;
  aiAnalyzed?: boolean;
  breakdown?: GemScoreBreakdown | null;
}

export interface AiRescoreSuggestion {
  mint: string;
  symbol: string;
  reason: string;
  delta: number;
  aiGemScore: number | null;
}

/** Gem đã được AI chấm cao và chưa nằm trong portfolio mở / chưa mua lần này. */
export function isAiHighUnbought(params: {
  gemScore: number | null | undefined;
  mint: string;
  openMints: Set<string>;
  boughtMints: Set<string>;
}): boolean {
  const floor = getAiHighScoreFloor();
  if (params.gemScore == null || params.gemScore < floor) return false;
  if (params.openMints.has(params.mint)) return false;
  if (params.boughtMints.has(params.mint)) return false;
  return true;
}

/** Sau mỗi lần scan: đưa gems AI chấm cao nhưng bị skip mua vào watchlist. */
export async function ingestAiHighUnboughtFromScan(
  scored: ScanGemForAiTrack[],
  decisions: EntryDecision[] = [],
): Promise<number> {
  const openMints = new Set((await getOpenPositions()).map((p) => p.mint));
  const boughtMints = new Set(
    decisions.filter((d) => d.action === "bought").map((d) => d.mint),
  );
  const skipByMint = new Map(
    decisions.filter((d) => d.action === "skipped").map((d) => [d.mint, d.reason]),
  );

  const candidates = scored
    .filter(
      (g) =>
        g.aiAnalyzed &&
        isAiHighUnbought({
          gemScore: g.gemScore,
          mint: g.mint,
          openMints,
          boughtMints,
        }),
    )
    .map((g) => ({
      mint: g.mint,
      symbol: g.symbol,
      name: g.name,
      scoreTotal: g.breakdown?.total ?? 0,
      scoreCoverage: g.breakdown?.coverage ?? 0,
      aiGemScore: g.gemScore ?? null,
      aiRiskScore: g.riskScore ?? null,
      skipReason:
        skipByMint.get(g.mint) ??
        `AI ${g.gemScore}/10 — chưa mua vào portfolio`,
      priceUsd: g.price ?? null,
      breakdown: g.breakdown ?? null,
    }));

  await upsertWatchCandidates(candidates);
  return candidates.length;
}

/** Điểm hard-score đang cải thiện so với lần kiểm tra trước. */
export function hasPositiveScoreTrend(
  entry: Pick<WatchedGemEntry, "scoreDelta" | "positiveTrendTicks">,
  delta: number,
): boolean {
  if (delta <= 0) return false;
  const priorTicks = entry.positiveTrendTicks ?? 0;
  if (priorTicks >= 1 && delta > 0) return true;
  return delta >= 2;
}

export interface ScoreSnapshot {
  total: number;
  coverage: number;
}

/**
 * Quyết định có nên đề xuất AI agent chấm lại hay không.
 * Ưu tiên gems đã từng được AI chấm cao khi hard-score tăng tích cực.
 */
export function shouldSuggestAiRescore(
  entry: WatchedGemEntry,
  prev: ScoreSnapshot,
  next: ScoreSnapshot,
  minBuy: number,
): AiRescoreSuggestion | null {
  const delta = next.total - prev.total;
  const aiFloor = getAiHighScoreFloor();
  const isAiHigh = (entry.aiGemScore ?? 0) >= aiFloor;

  const base = {
    mint: entry.mint,
    symbol: entry.symbol,
    delta,
    aiGemScore: entry.aiGemScore,
  };

  if (next.total >= minBuy && prev.total < minBuy) {
    return { ...base, reason: "crossed-buy-threshold" };
  }
  if (delta >= 5) {
    return { ...base, reason: "strong-hard-score-jump" };
  }
  if (
    delta >= 3 &&
    next.coverage >= 0.5 &&
    next.coverage - prev.coverage >= 0.08
  ) {
    return { ...base, reason: "score-and-coverage-up" };
  }
  if (next.total >= minBuy - 5 && delta >= 2) {
    return { ...base, reason: "near-buy-threshold" };
  }

  if (!isAiHigh) return null;

  if (hasPositiveScoreTrend(entry, delta)) {
    return { ...base, reason: "ai-high-positive-trend" };
  }
  if (next.total >= minBuy - 8 && delta >= 1) {
    return { ...base, reason: "ai-high-approaching-buy" };
  }
  if (delta >= 2 && (entry.aiGemScore ?? 0) >= 8) {
    return { ...base, reason: "ai-strong-hard-score-up" };
  }

  return null;
}

/** Cập nhật số lần liên tiếp hard-score tăng (dùng cho trend detection). */
export function nextPositiveTrendTicks(
  entry: Pick<WatchedGemEntry, "positiveTrendTicks">,
  delta: number,
): number {
  if (delta > 0) return (entry.positiveTrendTicks ?? 0) + 1;
  return 0;
}
