// Watchlist of strong gems that did not clear the buy threshold. Kept at the
// project root (gemradar-gem-watchlist.json), max 30 by deterministic score.

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import type { GemScoreBreakdown } from "./gem-score";

const STORE_PATH = path.join(process.cwd(), "gemradar-gem-watchlist.json");

export const MAX_WATCHLIST_SIZE = 30;
const DEFAULT_WATCH_FLOOR = 55;
const DEFAULT_DROP_FLOOR = 38;

export function getWatchScoreFloor(): number {
  const n = Number(process.env.GEM_WATCH_FLOOR ?? DEFAULT_WATCH_FLOOR);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.floor(n))) : DEFAULT_WATCH_FLOOR;
}

export function getWatchDropFloor(): number {
  const n = Number(process.env.GEM_WATCH_DROP_FLOOR ?? DEFAULT_DROP_FLOOR);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.floor(n))) : DEFAULT_DROP_FLOOR;
}

export type WatchStatus = "watching" | "pending_ai";

export interface WatchedGemEntry {
  mint: string;
  symbol: string;
  name: string;
  addedAt: string;
  lastCheckedAt: string | null;
  scoreTotal: number;
  scoreCoverage: number;
  priorScoreTotal: number | null;
  peakScoreTotal: number;
  scoreDelta: number | null;
  /** Số lần liên tiếp hard-score tăng (hourly recheck). */
  positiveTrendTicks: number;
  aiGemScore: number | null;
  aiRiskScore: number | null;
  lastSkipReason: string | null;
  status: WatchStatus;
  /** Lý do đề xuất AI chấm lại (null = chưa đề xuất). */
  aiRescoreReason: string | null;
  lastPriceUsd: number | null;
  lastBreakdown: GemScoreBreakdown | null;
}

interface StoreShape {
  items: WatchedGemEntry[];
  updatedAt: string;
}

async function readStore(): Promise<StoreShape> {
  try {
    const raw = JSON.parse(await readFile(STORE_PATH, "utf8")) as Partial<StoreShape>;
    return {
      items: Array.isArray(raw.items) ? raw.items : [],
      updatedAt: raw.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return { items: [], updatedAt: new Date().toISOString() };
  }
}

async function writeStore(store: StoreShape): Promise<void> {
  await mkdir(path.dirname(STORE_PATH), { recursive: true });
  const tmp = `${STORE_PATH}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await rename(tmp, STORE_PATH);
}

export async function listWatchlist(): Promise<WatchedGemEntry[]> {
  const store = await readStore();
  return [...store.items].sort((a, b) => b.scoreTotal - a.scoreTotal);
}

function trimToMax(items: WatchedGemEntry[]): WatchedGemEntry[] {
  return [...items].sort((a, b) => b.scoreTotal - a.scoreTotal).slice(0, MAX_WATCHLIST_SIZE);
}

export interface UpsertWatchCandidate {
  mint: string;
  symbol: string;
  name: string;
  scoreTotal: number;
  scoreCoverage: number;
  aiGemScore?: number | null;
  aiRiskScore?: number | null;
  skipReason?: string | null;
  priceUsd?: number | null;
  breakdown?: GemScoreBreakdown | null;
}

/** Merge scan candidates; keeps the top MAX_WATCHLIST_SIZE by score. */
export async function upsertWatchCandidates(
  candidates: UpsertWatchCandidate[],
  now = new Date(),
): Promise<void> {
  if (candidates.length === 0) return;
  const store = await readStore();
  const byMint = new Map(store.items.map((i) => [i.mint, i]));
  const iso = now.toISOString();

  for (const c of candidates) {
    const prev = byMint.get(c.mint);
    if (prev) {
      const prior = prev.scoreTotal;
      byMint.set(c.mint, {
        ...prev,
        symbol: c.symbol || prev.symbol,
        name: c.name || prev.name,
        scoreTotal: c.scoreTotal,
        scoreCoverage: c.scoreCoverage,
        priorScoreTotal: prior,
        scoreDelta: c.scoreTotal - prior,
        peakScoreTotal: Math.max(prev.peakScoreTotal, c.scoreTotal),
        aiGemScore: c.aiGemScore ?? prev.aiGemScore,
        aiRiskScore: c.aiRiskScore ?? prev.aiRiskScore,
        lastSkipReason: c.skipReason ?? prev.lastSkipReason,
        positiveTrendTicks: prev.positiveTrendTicks ?? 0,
        aiRescoreReason: prev.aiRescoreReason ?? null,
        lastPriceUsd: c.priceUsd ?? prev.lastPriceUsd,
        lastBreakdown: c.breakdown ?? prev.lastBreakdown,
        status: prev.status === "pending_ai" ? prev.status : "watching",
      });
    } else {
      byMint.set(c.mint, {
        mint: c.mint,
        symbol: c.symbol,
        name: c.name,
        addedAt: iso,
        lastCheckedAt: iso,
        scoreTotal: c.scoreTotal,
        scoreCoverage: c.scoreCoverage,
        priorScoreTotal: null,
        peakScoreTotal: c.scoreTotal,
        scoreDelta: null,
        positiveTrendTicks: 0,
        aiGemScore: c.aiGemScore ?? null,
        aiRiskScore: c.aiRiskScore ?? null,
        lastSkipReason: c.skipReason ?? null,
        status: "watching",
        aiRescoreReason: null,
        lastPriceUsd: c.priceUsd ?? null,
        lastBreakdown: c.breakdown ?? null,
      });
    }
  }

  await writeStore({
    items: trimToMax([...byMint.values()]),
    updatedAt: iso,
  });
}

export async function updateWatchEntry(
  mint: string,
  patch: Partial<WatchedGemEntry>,
): Promise<WatchedGemEntry | null> {
  const store = await readStore();
  const idx = store.items.findIndex((i) => i.mint === mint);
  if (idx < 0) return null;
  store.items[idx] = { ...store.items[idx], ...patch };
  store.updatedAt = new Date().toISOString();
  await writeStore(store);
  return store.items[idx];
}

export async function removeWatchMints(mints: string[]): Promise<void> {
  if (mints.length === 0) return;
  const drop = new Set(mints);
  const store = await readStore();
  store.items = store.items.filter((i) => !drop.has(i.mint));
  store.updatedAt = new Date().toISOString();
  await writeStore(store);
}

export async function replaceWatchlistItems(items: WatchedGemEntry[]): Promise<void> {
  await writeStore({
    items: trimToMax(items),
    updatedAt: new Date().toISOString(),
  });
}
