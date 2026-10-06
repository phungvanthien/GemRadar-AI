// After each solana-gems scan, push near-miss tokens into the watchlist.

import { loadSettings } from "./settings-store";
import { getOpenPositions } from "./position-store";
import {
  getWatchScoreFloor,
  upsertWatchCandidates,
} from "./gem-watchlist-store";
import type { GemScoreBreakdown } from "./gem-score";

export interface ScanResultForWatch {
  mint: string;
  symbol: string;
  name: string;
  price?: number;
  gemScore?: number | null;
  riskScore?: number | null;
  aiAnalyzed?: boolean;
  breakdown?: GemScoreBreakdown | null;
}

export async function ingestWatchCandidatesFromScan(
  scored: ScanResultForWatch[],
): Promise<number> {
  const settings = loadSettings();
  const minBuy = settings.minGemScoreToTrigger;
  const floor = getWatchScoreFloor();
  const openMints = new Set((await getOpenPositions()).map((p) => p.mint));

  const candidates = scored
    .filter((g) => {
      const total = g.breakdown?.total ?? 0;
      const cov = g.breakdown?.coverage ?? 0;
      if (openMints.has(g.mint)) return false;
      if (total < floor || total >= minBuy) return false;
      if (cov < 0.35) return false;
      return true;
    })
    .map((g) => ({
      mint: g.mint,
      symbol: g.symbol,
      name: g.name,
      scoreTotal: g.breakdown!.total,
      scoreCoverage: g.breakdown!.coverage,
      aiGemScore: g.aiAnalyzed ? g.gemScore ?? null : null,
      aiRiskScore: g.aiAnalyzed ? g.riskScore ?? null : null,
      skipReason: `total ${g.breakdown!.total} < buy ${minBuy}`,
      priceUsd: g.price ?? null,
      breakdown: g.breakdown ?? null,
    }));

  await upsertWatchCandidates(candidates);
  return candidates.length;
}
