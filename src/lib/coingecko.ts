import type { MarketToken } from "./types";

const CG_BASE = "https://api.coingecko.com/api/v3";

// CoinGecko's free tier needs no key. A Demo/Pro key, if present, raises rate
// limits — send it via the documented header when configured.
function authHeaders(): Record<string, string> {
  const key = process.env.COINGECKO_API_KEY;
  return key ? { "x-cg-demo-api-key": key } : {};
}

async function cgFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${CG_BASE}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json", ...authHeaders() },
    next: { revalidate: 60 },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`CoinGecko API error (${res.status}): ${body}`);
  }

  return res.json() as Promise<T>;
}

interface CgMarket {
  id: string;
  symbol: string;
  name: string;
  current_price: number | null;
  market_cap: number | null;
  market_cap_rank: number | null;
  total_volume: number | null;
  price_change_percentage_24h_in_currency: number | null;
  price_change_percentage_7d_in_currency: number | null;
}

interface CgGlobalResponse {
  data: {
    total_market_cap: { usd: number };
    market_cap_percentage: { btc: number };
  };
}

// MarketToken.id is numeric; CoinGecko ids are strings ("bitcoin"). Derive a
// stable numeric id from the string so the shape matches, and keep the original
// id in `slug` for lookups.
function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function mapMarket(item: CgMarket, index: number): MarketToken {
  return {
    id: hashId(item.id),
    name: item.name,
    symbol: item.symbol.toUpperCase(),
    slug: item.id,
    price: item.current_price ?? 0,
    marketCap: item.market_cap ?? 0,
    volume24h: item.total_volume ?? 0,
    percentChange24h: item.price_change_percentage_24h_in_currency ?? 0,
    percentChange7d: item.price_change_percentage_7d_in_currency ?? undefined,
    rank: item.market_cap_rank ?? index + 1,
  };
}

export async function fetchListings(limit = 200): Promise<MarketToken[]> {
  // CoinGecko caps per_page at 250; page through when more is requested.
  const perPage = Math.min(limit, 250);
  const pages = Math.ceil(limit / perPage);
  const all: MarketToken[] = [];

  for (let page = 1; page <= pages; page++) {
    const data = await cgFetch<CgMarket[]>("/coins/markets", {
      vs_currency: "usd",
      order: "market_cap_desc",
      per_page: String(perPage),
      page: String(page),
      price_change_percentage: "24h,7d",
    });
    if (data.length === 0) break;
    data.forEach((item, i) => all.push(mapMarket(item, (page - 1) * perPage + i)));
    if (data.length < perPage) break;
  }

  return all.slice(0, limit);
}

export async function fetchGlobalMetrics(): Promise<{
  btcDominance: number;
  totalMarketCap: number;
}> {
  const data = await cgFetch<CgGlobalResponse>("/global");
  return {
    btcDominance: data.data.market_cap_percentage.btc,
    totalMarketCap: data.data.total_market_cap.usd,
  };
}

export async function fetchFearGreed(): Promise<{ value: number; label: string }> {
  const res = await fetch("https://api.alternative.me/fng/?limit=1", {
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error("Failed to fetch Fear & Greed index");
  const json = (await res.json()) as {
    data: { value: string; value_classification: string }[];
  };
  const item = json.data[0];
  return {
    value: Number(item.value),
    label: item.value_classification,
  };
}

export function filterHiddenGems(tokens: MarketToken[]): MarketToken[] {
  return tokens.filter(
    (t) =>
      t.marketCap > 1_000_000 &&
      t.marketCap < 100_000_000 &&
      t.volume24h > 300_000 &&
      t.percentChange24h > -5,
  );
}

export function getTopMovers(tokens: MarketToken[], count = 5) {
  const sorted = [...tokens].sort(
    (a, b) => b.percentChange24h - a.percentChange24h,
  );
  return {
    gainers: sorted.slice(0, count),
    losers: [...tokens]
      .sort((a, b) => a.percentChange24h - b.percentChange24h)
      .slice(0, count),
  };
}

export function getTrending(tokens: MarketToken[], count = 12): MarketToken[] {
  return [...tokens]
    .sort((a, b) => b.volume24h - a.volume24h)
    .slice(0, count);
}
