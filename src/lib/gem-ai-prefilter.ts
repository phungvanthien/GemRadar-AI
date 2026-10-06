// Pre-filter before the LLM: rank by deterministic gem score, then send only the
// top N to analyzeSolanaGems. Saves AI tokens when the worker scans many mints.

import type { SolanaGemInput } from "./ai";
import type { GemScoreBreakdown } from "./gem-score";

const DEFAULT_TOP_N = 3;
const MAX_TOP_N = 15;

export function getAiGemCandidateLimit(): number {
  const n = Number(process.env.GEM_AI_TOP_N ?? DEFAULT_TOP_N);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_TOP_N;
  return Math.min(MAX_TOP_N, Math.floor(n));
}

/** Higher = riskier (RugCheck normalised score, or inverted security category). */
export function deterministicRiskScore(
  input: SolanaGemInput,
  breakdown: GemScoreBreakdown,
): number {
  const rc = input.onChain.rugcheck?.scoreNormalised;
  if (rc != null && Number.isFinite(rc)) return rc;
  return 100 - breakdown.security.score;
}

/**
 * Pick up to `limit` inputs for AI scoring: highest deterministic total first,
 * then highest deterministic risk (tie-break).
 */
export function selectInputsForAiAnalysis(
  inputs: SolanaGemInput[],
  scoreByMint: Map<string, GemScoreBreakdown>,
  limit = getAiGemCandidateLimit(),
): SolanaGemInput[] {
  if (inputs.length === 0) return [];

  const ranked = [...inputs].sort((a, b) => {
    const ba = scoreByMint.get(a.onChain.mint);
    const bb = scoreByMint.get(b.onChain.mint);
    const totalA = ba?.total ?? 0;
    const totalB = bb?.total ?? 0;
    if (totalB !== totalA) return totalB - totalA;
    if (!ba || !bb) return 0;
    return (
      deterministicRiskScore(b, bb) - deterministicRiskScore(a, ba)
    );
  });

  return ranked.slice(0, Math.min(limit, ranked.length));
}
