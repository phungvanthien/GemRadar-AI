// Jupiter Price API v3 — free tier, no key required.
//
// Endpoint: https://lite-api.jup.ag/price/v3?ids=<mint>,<mint>,...
// The older price.jup.ag/v6 and /v2 are dead (verified: v6 unreachable, v2 404).
// v3 returns a map keyed by mint; unknown mints are simply omitted (HTTP 200 with
// an empty/partial object), and response order is NOT input order — always map by
// key. v3 gives price + aggregate liquidity + 24h change, but NOT 24h volume.

import type { JupiterMarketData } from "./gem-score";

const BASE_URL = "https://lite-api.jup.ag/price/v3";
const DEFAULT_TIMEOUT_MS = 10_000;
// v3 accepts many ids per call; keep batches modest to stay well under any URL
// length / rate limits.
const BATCH_SIZE = 50;

interface RawPrice {
  usdPrice?: number;
  liquidity?: number;
  priceChange24h?: number;
  decimals?: number;
}

export interface JupiterPrice extends JupiterMarketData {
  mint: string;
  decimals: number | null;
}

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

async function fetchBatch(mints: string[]): Promise<Map<string, JupiterPrice>> {
  const result = new Map<string, JupiterPrice>();
  if (mints.length === 0) return result;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}?ids=${mints.join(",")}`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return result; // degrade: caller treats missing mints as null
    const raw = (await res.json()) as Record<string, RawPrice> | null;
    if (!raw || typeof raw !== "object") return result;

    for (const [mint, p] of Object.entries(raw)) {
      if (!p || typeof p !== "object") continue;
      result.set(mint, {
        mint,
        usdPrice: num(p.usdPrice),
        liquidity: num(p.liquidity),
        priceChange24h: num(p.priceChange24h),
        decimals: num(p.decimals),
      });
    }
  } catch {
    // Network error / timeout — degrade to whatever we collected (nothing).
  } finally {
    clearTimeout(timeout);
  }
  return result;
}

// Fetch price/liquidity for a set of mints. Batches large sets and merges the
// results. Mints Jupiter doesn't know are absent from the returned map — callers
// treat a missing mint as "no data" rather than an error. Never throws.
export async function getJupiterPrices(
  mints: string[],
): Promise<Map<string, JupiterPrice>> {
  const unique = [...new Set(mints)];
  const merged = new Map<string, JupiterPrice>();

  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    batches.push(unique.slice(i, i + BATCH_SIZE));
  }

  const results = await Promise.all(batches.map(fetchBatch));
  for (const batch of results) {
    for (const [mint, price] of batch) merged.set(mint, price);
  }
  return merged;
}
