import type { MarketToken } from "./types";

const CMC_BASE = "https://pro-api.coinmarketcap.com/v1";

function getApiKey(): string {
  const key = process.env.COINMARKETCAP_API_KEY;
  if (!key) {
    throw new Error("COINMARKETCAP_API_KEY is not configured");
  }
  return key;
}

async function cmcFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${CMC_BASE}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const res = await fetch(url.toString(), {
    headers: {
      "X-CMC_PRO_API_KEY": getApiKey(),
      Accept: "application/json",
    },
    next: { revalidate: 60 },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`CoinMarketCap API error (${res.status}): ${body}`);
  }

  return res.json() as Promise<T>;
}

interface CmcListing {
  id: number;
  name: string;
  symbol: string;
  slug: string;
  cmc_rank: number;
  quote: {
    USD: {
      price: number;
      market_cap: number;
      volume_24h: number;
      percent_change_24h: number;
      percent_change_7d?: number;
    };
  };
}

interface ListingsResponse {
  data: CmcListing[];
}

interface GlobalMetricsResponse {
  data: {
    btc_dominance: number;
    quote: { USD: { total_market_cap: number } };
  };
}

function mapListing(item: CmcListing): MarketToken {
  const usd = item.quote.USD;
  return {
    id: item.id,
    name: item.name,
    symbol: item.symbol,
    slug: item.slug,
    price: usd.price,
    marketCap: usd.market_cap,
    volume24h: usd.volume_24h,
    percentChange24h: usd.percent_change_24h,
    percentChange7d: usd.percent_change_7d,
    rank: item.cmc_rank,
  };
}

export async function fetchListings(limit = 200): Promise<MarketToken[]> {
  const data = await cmcFetch<ListingsResponse>("/cryptocurrency/listings/latest", {
    limit: String(limit),
    convert: "USD",
  });
  return data.data.map(mapListing);
}

export async function fetchGlobalMetrics(): Promise<{
  btcDominance: number;
  totalMarketCap: number;
}> {
  const data = await cmcFetch<GlobalMetricsResponse>("/global-metrics/quotes/latest", {
    convert: "USD",
  });
  return {
    btcDominance: data.data.btc_dominance,
    totalMarketCap: data.data.quote.USD.total_market_cap,
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

  const filtered = tokens.filter(
  (t) =>
    t.marketCap > 1_000_000 &&
    t.marketCap < 100_000_000 &&
    t.volume24h > 300_000 &&
    t.percentChange24h > -5
);



  return filtered;
}

export function getTopMovers(tokens: MarketToken[], count = 5) {
  const sorted = [...tokens].sort(
    (a, b) => b.percentChange24h - a.percentChange24h
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
