import { NextResponse } from "next/server";
import { filterHiddenGems, fetchListings } from "@/lib/coingecko";
import { analyzeGems } from "@/lib/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  try {
    const listings = await fetchListings(500);
    const candidates = filterHiddenGems(listings);

    if (candidates.length === 0) {
      return NextResponse.json({
        gems: [],
        message: "No tokens matched the hidden gem criteria right now. Try again later.",
        filteredCount: 0,
      });
    }

    const ranked = [...candidates]
      .sort((a, b) => b.percentChange24h - a.percentChange24h)
      .slice(0, 15);

    const gems = await analyzeGems(ranked);

    return NextResponse.json({
      gems,
      filteredCount: candidates.length,
      analyzedCount: ranked.length,
    });
  } catch (error) {
    console.error("[/api/gems]", error);
    const message = error instanceof Error ? error.message : "Gem scan failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
