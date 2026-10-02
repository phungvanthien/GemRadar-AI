import { NextResponse } from "next/server";
import {
  getRugcheckNewTokens,
  getRugcheckViewedTokens,
  getRugcheckTrendingTokens,
  getRugcheckRecentlyVerified,
} from "@/lib/rugcheck";

export const dynamic = "force-dynamic";

// The public RugCheck discovery feeds, one per ?feed value. All degrade to an
// empty list on failure, so the route never errors on an upstream outage.
const FEEDS = {
  new: getRugcheckNewTokens,
  viewed: getRugcheckViewedTokens,
  trending: getRugcheckTrendingTokens,
  verified: getRugcheckRecentlyVerified,
} as const;

type Feed = keyof typeof FEEDS;

function isFeed(value: string | null): value is Feed {
  return value !== null && value in FEEDS;
}

// GET /api/rugcheck-stats?feed=new|viewed|trending|verified -> a RugCheck
// discovery feed. Defaults to "new". Feeds seed the gem pipeline with fresh
// launches, attention leaders, community-trending, and just-verified tokens.
export async function GET(request: Request) {
  try {
    const feedParam = new URL(request.url).searchParams.get("feed");
    const feed: Feed = isFeed(feedParam) ? feedParam : "new";

    const tokens = await FEEDS[feed]();
    return NextResponse.json({ feed, tokens, updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("[/api/rugcheck-stats]", error);
    const message = error instanceof Error ? error.message : "Failed to fetch stats feed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
