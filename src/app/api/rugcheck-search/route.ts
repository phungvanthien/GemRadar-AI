import { NextResponse } from "next/server";
import { searchRugcheckTokens } from "@/lib/rugcheck";

export const dynamic = "force-dynamic";

// GET /api/rugcheck-search?q=bonk&limit=20 -> RugCheck token search.
// An empty q returns trending tokens. Results degrade to [] on any failure.
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const q = params.get("q") ?? "";
    const rawLimit = Number(params.get("limit"));
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 20;

    const results = await searchRugcheckTokens(q, limit);
    return NextResponse.json({ results, updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("[/api/rugcheck-search]", error);
    const message = error instanceof Error ? error.message : "Failed to search tokens";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
