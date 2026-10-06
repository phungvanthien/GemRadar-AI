// Hourly deterministic re-score for the gem watchlist (no LLM). Uses the same
// data sources as scan_token / the solana-gems enrich step. When scores trend
// up, selected mints are escalated to analyzeSolanaGems + maybeEnterPositions.

import { enrichWithOnChain } from "./flux-solana";
import { getRugcheckReport } from "./rugcheck";
import { getJupiterPrices } from "./jupiter";
import { getDexScreenerData } from "./dexscreener";
import { getSocialSignalsBulk } from "./social-store";
import { computeGemScore, type GemScoreBreakdown } from "./gem-score";
import { analyzeSolanaGems, type SolanaGemInput } from "./ai";
import { loadSettings } from "./settings-store";
import { getOpenPositions } from "./position-store";
import { maybeEnterPositions, type ScoredGem } from "./trade-entry";
import {
  getWatchDropFloor,
  getWatchScoreFloor,
  listWatchlist,
  replaceWatchlistItems,
  type WatchedGemEntry,
} from "./gem-watchlist-store";
import {
  shouldSuggestAiRescore,
  nextPositiveTrendTicks,
  type AiRescoreSuggestion,
} from "./gem-ai-unbought-tracker";
import type { SolanaRugcheckSignal } from "./types";

const MAX_AI_ESCALATIONS_PER_TICK = 3;

/** @deprecated Dùng shouldSuggestAiRescore — giữ cho tương thích test/script cũ. */
export function shouldEscalateToAi(
  prev: { total: number; coverage: number },
  next: { total: number; coverage: number },
  minBuy: number,
): boolean {
  return (
    shouldSuggestAiRescore(
      {
        mint: "",
        symbol: "",
        aiGemScore: null,
        positiveTrendTicks: 0,
      } as WatchedGemEntry,
      prev,
      next,
      minBuy,
    ) != null
  );
}

export async function buildDeterministicGemSnapshot(
  mint: string,
  symbol: string,
  name: string,
): Promise<{ input: SolanaGemInput; breakdown: GemScoreBreakdown; priceUsd: number | null } | null> {
  const [report, jupiterMap, dexMap, socialMap] = await Promise.all([
    getRugcheckReport(mint),
    getJupiterPrices([mint]),
    getDexScreenerData([mint]),
    getSocialSignalsBulk([mint]),
  ]);

  const rugcheck: SolanaRugcheckSignal | null = report
    ? {
        scoreNormalised: report.scoreNormalised,
        topRisks: report.risks
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
          .map((r) => r.name),
        lpLockedPct: report.lpLockedPct,
        insiderNetworkCount: report.insiderNetworks.length,
        totalMarketLiquidity: report.totalMarketLiquidity,
      }
    : null;

  let onChain;
  try {
    onChain = await enrichWithOnChain(mint, undefined, rugcheck);
  } catch {
    return null;
  }

  const jup = jupiterMap.get(mint);
  const dex = dexMap.get(mint);
  const fileSignal = socialMap.get(mint);
  const social: { socialScore?: number; xScore?: number } | null =
    fileSignal?.socialScore != null || fileSignal?.xScore != null
      ? {
          ...(fileSignal.socialScore != null ? { socialScore: fileSignal.socialScore } : {}),
          ...(fileSignal.xScore != null ? { xScore: fileSignal.xScore } : {}),
        }
      : null;

  const breakdown = computeGemScore({
    onChain,
    jupiter: jup
      ? {
          usdPrice: jup.usdPrice,
          liquidity: jup.liquidity,
          priceChange24h: jup.priceChange24h,
        }
      : null,
    dex: dex ?? null,
    social,
  });

  const price = jup?.usdPrice ?? undefined;
  const marketCap =
    dex?.marketCap ??
    (jup?.usdPrice != null && onChain.supply > 0 ? jup.usdPrice * onChain.supply : undefined);

  const input: SolanaGemInput = {
    symbol,
    name,
    onChain,
    price,
    marketCap,
    volume24h: dex?.volume24h ?? undefined,
    percentChange24h: dex?.priceChange24h ?? jup?.priceChange24h ?? undefined,
  };

  return {
    input,
    breakdown,
    priceUsd: jup?.usdPrice ?? null,
  };
}

export interface WatchRecheckSummary {
  checked: number;
  dropped: number;
  escalated: number;
  aiAnalyzed: number;
  bought: string[];
  /** Gems có xu hướng điểm tốt — đề xuất AI chấm lại. */
  aiRescoreSuggested: AiRescoreSuggestion[];
  errors: string[];
}

export async function runWatchlistRecheckTick(now = new Date()): Promise<WatchRecheckSummary> {
  const summary: WatchRecheckSummary = {
    checked: 0,
    dropped: 0,
    escalated: 0,
    aiAnalyzed: 0,
    bought: [],
    aiRescoreSuggested: [],
    errors: [],
  };

  const settings = loadSettings();
  const minBuy = settings.minGemScoreToTrigger;
  const watchFloor = getWatchScoreFloor();
  const dropFloor = getWatchDropFloor();
  const iso = now.toISOString();

  const openMints = new Set((await getOpenPositions()).map((p) => p.mint));
  let items = await listWatchlist();
  items = items.filter((i) => !openMints.has(i.mint));

  const toDrop: string[] = [];
  const updated: WatchedGemEntry[] = [];
  const escalateCandidates: {
    entry: WatchedGemEntry;
    input: SolanaGemInput;
    breakdown: GemScoreBreakdown;
    delta: number;
    suggestion: AiRescoreSuggestion;
  }[] = [];

  for (const entry of items) {
    const snap = await buildDeterministicGemSnapshot(entry.mint, entry.symbol, entry.name);
    summary.checked += 1;

    if (!snap) {
      summary.errors.push(`${entry.symbol}: rescore failed`);
      updated.push({
        ...entry,
        lastCheckedAt: iso,
      });
      continue;
    }

    const { input, breakdown, priceUsd } = snap;
    const prevTotal = entry.scoreTotal;
    const prevCov = entry.scoreCoverage;
    const delta = breakdown.total - prevTotal;

    if (breakdown.total < dropFloor) {
      toDrop.push(entry.mint);
      summary.dropped += 1;
      continue;
    }

    const trendTicks = nextPositiveTrendTicks(entry, delta);
    const suggestion = shouldSuggestAiRescore(
      entry,
      { total: prevTotal, coverage: prevCov },
      { total: breakdown.total, coverage: breakdown.coverage },
      minBuy,
    );

    const nextEntry: WatchedGemEntry = {
      ...entry,
      lastCheckedAt: iso,
      priorScoreTotal: prevTotal,
      scoreTotal: breakdown.total,
      scoreCoverage: breakdown.coverage,
      scoreDelta: delta,
      positiveTrendTicks: trendTicks,
      peakScoreTotal: Math.max(entry.peakScoreTotal, breakdown.total),
      lastPriceUsd: priceUsd,
      lastBreakdown: breakdown,
      status: suggestion ? "pending_ai" : "watching",
      aiRescoreReason: suggestion?.reason ?? null,
    };

    if (suggestion && breakdown.total >= watchFloor) {
      escalateCandidates.push({
        entry: nextEntry,
        input,
        breakdown,
        delta,
        suggestion,
      });
      summary.aiRescoreSuggested.push(suggestion);
    }

    updated.push(nextEntry);
  }

  escalateCandidates.sort((a, b) => {
    const aiBoost =
      (b.entry.aiGemScore ?? 0) - (a.entry.aiGemScore ?? 0);
    if (aiBoost !== 0) return aiBoost;
    return b.delta - a.delta;
  });
  const toEscalate = escalateCandidates.slice(0, MAX_AI_ESCALATIONS_PER_TICK);
  summary.escalated = toEscalate.length;

  const aiInputs = toEscalate.map((e) => e.input);
  let aiResults: ScoredGem[] = [];

  if (aiInputs.length > 0) {
    try {
      const gems = await analyzeSolanaGems(aiInputs);
      aiResults = gems.map((g) => {
        const match = toEscalate.find((e) => e.input.onChain.mint === g.mint);
        return {
          ...g,
          breakdown: match?.breakdown ?? null,
        };
      });
      summary.aiAnalyzed = aiResults.length;

      const decisions = await maybeEnterPositions(aiResults);
      for (const d of decisions) {
        if (d.action === "bought") {
          summary.bought.push(d.symbol);
          toDrop.push(d.mint);
        }
      }
    } catch (e) {
      summary.errors.push(
        e instanceof Error ? e.message : "AI escalation failed",
      );
    }
  }

  const aiByMint = new Map(aiResults.map((g) => [g.mint, g]));

  const finalItems = updated
    .filter((i) => !toDrop.includes(i.mint))
    .map((i) => {
      const ai = aiByMint.get(i.mint);
      if (!ai) return i;
      return {
        ...i,
        aiGemScore: ai.gemScore,
        aiRiskScore: ai.riskScore,
        status: "watching" as const,
        lastSkipReason:
          i.scoreTotal >= minBuy ? "awaiting-entry-guards" : i.lastSkipReason,
      };
    })
    .filter((i) => i.scoreTotal >= watchFloor || aiByMint.has(i.mint));

  await replaceWatchlistItems(finalItems);

  return summary;
}
