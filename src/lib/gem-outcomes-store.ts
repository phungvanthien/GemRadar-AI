// Outcome memory: a durable record of every gem the AI scored, plus the price at
// that moment, so a reconciliation job can later fill in how the token actually
// performed (1h / 24h / 7d). The aggregated hit/miss stats feed back into the AI
// scoring prompt (getScoringCalibration) so the model learns from its own past
// calls instead of scoring every token cold.
//
// Mirrors position-store.ts exactly: node:fs/promises, atomic write via temp +
// rename so a mid-write reconcile tick never reads a half-written file.
// Server-only. The file lives at the project root like the position ledger.

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";

const STORE_PATH = path.join(process.cwd(), "alphahunter-gem-outcomes.json");

// How the token performed by the time the reconcile job classified it. "pending"
// until the first horizon (1h) has data; terminal buckets are set at the 24h mark.
export type OutcomeClass = "pending" | "rug" | "flat" | "pump";

// Price samples taken by the reconcile worker at each horizon after scoring.
// null = Jupiter had no price for the mint at that check (dead token / no pool).
export interface OutcomeSamples {
  price1h?: number | null;
  price24h?: number | null;
  price7d?: number | null;
}

export interface GemOutcome {
  mint: string;
  symbol: string;
  scoredAt: string; // ISO — when the AI produced this verdict

  // Snapshot of the scores at scoring time (never mutated afterwards).
  hardScore: number; // deterministic computeGemScore total (0-100)
  aiGemScore: number; // AI gemScore (1-10)
  riskScore: number; // AI riskScore (1-10)
  coverage: number; // 0-1, how much of the model backed hardScore
  insiderNetworkCount: number | null; // RugCheck insider networks at scoring time

  priceAtScore: number | null; // USD price at scoring time (Jupiter), or null

  samples: OutcomeSamples;
  outcome: OutcomeClass;
}

interface StoreShape {
  // keyed by `${mint}-${scoredAtMs}` so the same mint scored twice is two rows
  outcomes: Record<string, GemOutcome>;
}

async function readStore(): Promise<StoreShape> {
  try {
    const raw = JSON.parse(await readFile(STORE_PATH, "utf8")) as Partial<StoreShape>;
    return { outcomes: raw.outcomes ?? {} };
  } catch {
    return { outcomes: {} };
  }
}

async function writeStore(store: StoreShape): Promise<void> {
  await mkdir(path.dirname(STORE_PATH), { recursive: true });
  const tmp = `${STORE_PATH}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await rename(tmp, STORE_PATH);
}

export interface RecordGemOutcomeInput {
  mint: string;
  symbol: string;
  hardScore: number;
  aiGemScore: number;
  riskScore: number;
  coverage: number;
  insiderNetworkCount?: number | null;
  priceAtScore?: number | null;
}

// Record a freshly-scored gem. Called fire-and-forget from the scan route, so it
// must never throw into the caller — callers wrap it, but we also keep it cheap.
// Returns the stored row id.
export async function recordGemOutcome(
  input: RecordGemOutcomeInput,
  now = new Date(),
): Promise<string> {
  const store = await readStore();
  const id = `${input.mint}-${now.getTime()}`;
  store.outcomes[id] = {
    mint: input.mint,
    symbol: input.symbol,
    scoredAt: now.toISOString(),
    hardScore: input.hardScore,
    aiGemScore: input.aiGemScore,
    riskScore: input.riskScore,
    coverage: input.coverage,
    insiderNetworkCount: input.insiderNetworkCount ?? null,
    priceAtScore: input.priceAtScore ?? null,
    samples: {},
    outcome: "pending",
  };
  await writeStore(store);
  return id;
}

export async function getAllOutcomes(): Promise<GemOutcome[]> {
  const store = await readStore();
  return Object.values(store.outcomes);
}

// Rows the reconcile job still needs to sample: those missing a horizon whose
// time has arrived. `now` lets tests pin the clock.
export function pendingHorizons(
  o: GemOutcome,
  now = new Date(),
): Array<"1h" | "24h" | "7d"> {
  const scoredMs = Date.parse(o.scoredAt);
  if (Number.isNaN(scoredMs)) return [];
  const ageMs = now.getTime() - scoredMs;
  const due: Array<"1h" | "24h" | "7d"> = [];
  const H = 3_600_000;
  if (ageMs >= 1 * H && o.samples.price1h === undefined) due.push("1h");
  if (ageMs >= 24 * H && o.samples.price24h === undefined) due.push("24h");
  if (ageMs >= 168 * H && o.samples.price7d === undefined) due.push("7d");
  return due;
}

// Classify an outcome from the 24h sample vs the scoring price. Called by the
// reconcile job once the 24h sample lands. Thresholds: rug <= -80%, pump >=
// +100%, flat in between. A null 24h sample (no price → likely dead) counts as
// a rug, since a token that lost its pool is the worst case.
function classify(o: GemOutcome): OutcomeClass {
  if (o.samples.price24h === undefined) return "pending";
  if (o.priceAtScore == null || o.priceAtScore <= 0) return "flat"; // can't compute ratio
  const p24 = o.samples.price24h;
  if (p24 == null) return "rug"; // lost its price feed within 24h
  const ratio = p24 / o.priceAtScore;
  if (ratio <= 0.2) return "rug";
  if (ratio >= 2.0) return "pump";
  return "flat";
}

// Fill in one horizon's price sample for a row and re-derive its outcome class.
// Idempotent per horizon (pendingHorizons won't re-offer a filled one).
export async function recordSample(
  id: string,
  horizon: "1h" | "24h" | "7d",
  price: number | null,
): Promise<void> {
  const store = await readStore();
  const o = store.outcomes[id];
  if (!o) return;
  if (horizon === "1h") o.samples.price1h = price;
  else if (horizon === "24h") o.samples.price24h = price;
  else o.samples.price7d = price;
  o.outcome = classify(o);
  store.outcomes[id] = o;
  await writeStore(store);
}

export interface ScoringCalibration {
  totalClassified: number;
  strongCount: number; // rows with aiGemScore >= 8
  strongRugRate: number | null; // share of those that rugged in 24h
  strongPumpRate: number | null;
  insiderRugMultiplier: number | null; // rug rate(insider>0) / rug rate(insider=0)
}

// Aggregate the classified history into the few numbers worth feeding back into
// the scoring prompt. Returns nulls when there isn't enough data to be meaningful
// (callers then omit that line from the prompt rather than cite a noisy stat).
export async function getScoringCalibration(): Promise<ScoringCalibration> {
  const all = await getAllOutcomes();
  const classified = all.filter((o) => o.outcome !== "pending");
  const n = classified.length;

  const strong = classified.filter((o) => o.aiGemScore >= 8);
  const strongRugRate =
    strong.length >= 5
      ? strong.filter((o) => o.outcome === "rug").length / strong.length
      : null;
  const strongPumpRate =
    strong.length >= 5
      ? strong.filter((o) => o.outcome === "pump").length / strong.length
      : null;

  // Insider effect: compare rug rate with insiders vs without. Only meaningful
  // when both buckets have a few rows each.
  const withIns = classified.filter((o) => (o.insiderNetworkCount ?? 0) > 0);
  const noIns = classified.filter((o) => (o.insiderNetworkCount ?? 0) === 0);
  let insiderRugMultiplier: number | null = null;
  if (withIns.length >= 5 && noIns.length >= 5) {
    const rugWith = withIns.filter((o) => o.outcome === "rug").length / withIns.length;
    const rugNo = noIns.filter((o) => o.outcome === "rug").length / noIns.length;
    if (rugNo > 0) insiderRugMultiplier = rugWith / rugNo;
  }

  return {
    totalClassified: n,
    strongCount: strong.length,
    strongRugRate,
    strongPumpRate,
    insiderRugMultiplier,
  };
}

// Render the calibration as a short prompt fragment, or "" when there's nothing
// trustworthy to say yet (empty history → no fragment → prompt unchanged).
export function renderCalibrationPrompt(cal: ScoringCalibration): string {
  const lines: string[] = [];
  if (cal.strongRugRate != null && cal.strongPumpRate != null) {
    lines.push(
      `- Of your last ${cal.strongCount} tokens scored 'strong' (gemScore >= 8): ` +
        `${Math.round(cal.strongPumpRate * 100)}% pumped (>=2x), ` +
        `${Math.round(cal.strongRugRate * 100)}% rugged (<=-80%) within 24h.`,
    );
  }
  if (cal.insiderRugMultiplier != null) {
    lines.push(
      `- Tokens with insiderNetworkCount > 0 rugged ` +
        `${cal.insiderRugMultiplier.toFixed(1)}x as often as those without.`,
    );
  }
  if (lines.length === 0) return "";
  return (
    `\nCalibration from your own past predictions (${cal.totalClassified} classified) — ` +
    `weigh these patterns; be more cautious where you have been wrong before:\n` +
    lines.join("\n")
  );
}
