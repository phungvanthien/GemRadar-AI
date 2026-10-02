// DexScreener API — free, no key required.
//
// Endpoint: https://api.dexscreener.com/tokens/v1/solana/<mint>,<mint>,...
// Returns one entry per trading PAIR (a mint can have several). We keep the
// deepest-liquidity pair per mint as its representative. This is the source of
// REAL 24h volume + buy/sell counts that Jupiter v3 doesn't provide, filling the
// Volume gap in gem-score.md.

const BASE_URL = "https://api.dexscreener.com/tokens/v1/solana";
const DEFAULT_TIMEOUT_MS = 10_000;
// The path is comma-joined mints in the URL; keep batches modest.
const BATCH_SIZE = 30;

interface RawPair {
  baseToken?: { address?: string; symbol?: string };
  volume?: { h24?: number; h6?: number; h1?: number };
  txns?: {
    h24?: { buys?: number; sells?: number };
    h1?: { buys?: number; sells?: number };
  };
  priceChange?: { h24?: number };
  liquidity?: { usd?: number };
  marketCap?: number;
  fdv?: number;
  pairCreatedAt?: number; // epoch ms
}

export interface DexScreenerData {
  mint: string;
  volume24h: number | null;
  buys24h: number | null;
  sells24h: number | null;
  priceChange24h: number | null;
  liquidityUsd: number | null;
  marketCap: number | null;
  pairCreatedAt: number | null;
}

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

// Pick the pair with the deepest USD liquidity — the most representative market
// for the token.
function bestPair(pairs: RawPair[]): RawPair | null {
  let best: RawPair | null = null;
  let bestLiq = -1;
  for (const p of pairs) {
    const liq = p.liquidity?.usd ?? 0;
    if (liq > bestLiq) {
      bestLiq = liq;
      best = p;
    }
  }
  return best;
}

function toData(mint: string, p: RawPair): DexScreenerData {
  return {
    mint,
    volume24h: num(p.volume?.h24),
    buys24h: num(p.txns?.h24?.buys),
    sells24h: num(p.txns?.h24?.sells),
    priceChange24h: num(p.priceChange?.h24),
    liquidityUsd: num(p.liquidity?.usd),
    marketCap: num(p.marketCap) ?? num(p.fdv),
    pairCreatedAt: num(p.pairCreatedAt),
  };
}

async function fetchBatch(mints: string[]): Promise<Map<string, DexScreenerData>> {
  const result = new Map<string, DexScreenerData>();
  if (mints.length === 0) return result;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/${mints.join(",")}`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return result;
    const raw = (await res.json()) as RawPair[] | null;
    if (!Array.isArray(raw)) return result;

    // Group pairs by base mint, then keep the deepest-liquidity pair per mint.
    const byMint = new Map<string, RawPair[]>();
    for (const p of raw) {
      const addr = p.baseToken?.address;
      if (!addr) continue;
      const list = byMint.get(addr) ?? [];
      list.push(p);
      byMint.set(addr, list);
    }
    for (const [mint, pairs] of byMint) {
      const best = bestPair(pairs);
      if (best) result.set(mint, toData(mint, best));
    }
  } catch {
    // Network error / timeout — degrade to whatever we collected.
  } finally {
    clearTimeout(timeout);
  }
  return result;
}

// Fetch market data for a set of mints. Batches large sets. Mints with no DEX
// pair are absent from the map — callers treat that as "no data". Never throws.
export async function getDexScreenerData(
  mints: string[],
): Promise<Map<string, DexScreenerData>> {
  const unique = [...new Set(mints)];
  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    batches.push(unique.slice(i, i + BATCH_SIZE));
  }
  const results = await Promise.all(batches.map(fetchBatch));
  const merged = new Map<string, DexScreenerData>();
  for (const batch of results) {
    for (const [mint, data] of batch) merged.set(mint, data);
  }
  return merged;
}
