import { NextResponse } from "next/server";
import {
  fetchFearGreed,
  fetchGlobalMetrics,
  fetchListings,
  getTopMovers,
  getTrending,
} from "@/lib/coinmarketcap";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [listings, global, fearGreed] = await Promise.all([
      fetchListings(200),
      fetchGlobalMetrics(),
      fetchFearGreed(),
    ]);

    const { gainers, losers } = getTopMovers(listings, 5);
    const trending = getTrending(listings, 12);

    return NextResponse.json({
      btcDominance: global.btcDominance,
      totalMarketCap: global.totalMarketCap,
      fearGreedIndex: fearGreed.value,
      fearGreedLabel: fearGreed.label,
      topGainers: gainers,
      topLosers: losers,
      trending,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[/api/market]", error);
    const message = error instanceof Error ? error.message : "Failed to fetch market data";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
