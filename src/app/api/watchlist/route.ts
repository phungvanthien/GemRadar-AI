import { NextResponse } from "next/server";
import { loadSettings } from "@/lib/settings-store";
import {
  getWatchScoreFloor,
  listWatchlist,
  MAX_WATCHLIST_SIZE,
} from "@/lib/gem-watchlist-store";
import { runWatchlistRecheckTick } from "@/lib/gem-watch-recheck";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  try {
    const settings = loadSettings();
    const items = await listWatchlist();
    return NextResponse.json({
      items,
      maxSize: MAX_WATCHLIST_SIZE,
      minGemScoreToTrigger: settings.minGemScoreToTrigger,
      watchScoreFloor: getWatchScoreFloor(),
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[/api/watchlist GET]", error);
    const message =
      error instanceof Error ? error.message : "Failed to load watchlist";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Deterministic hourly recheck + optional AI escalation (no chat agent). */
export async function POST() {
  try {
    const summary = await runWatchlistRecheckTick();
    const items = await listWatchlist();
    return NextResponse.json({
      ok: true,
      summary,
      items,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[/api/watchlist POST]", error);
    const message =
      error instanceof Error ? error.message : "Watchlist recheck failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
