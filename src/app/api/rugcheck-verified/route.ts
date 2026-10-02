import { NextResponse } from "next/server";
import { getRugcheckVerifiedTokens } from "@/lib/rugcheck";

export const dynamic = "force-dynamic";

// GET /api/rugcheck-verified?limit=20&cursor=<opaque> -> a page of the
// RugCheck-verified token list. Pass the returned nextCursor back unchanged to
// page. Degrades to an empty page on any failure.
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const rawLimit = Number(params.get("limit"));
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20;
    const cursor = params.get("cursor") ?? undefined;

    const { tokens, nextCursor } = await getRugcheckVerifiedTokens(limit, cursor);
    return NextResponse.json({ tokens, nextCursor, updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("[/api/rugcheck-verified]", error);
    const message = error instanceof Error ? error.message : "Failed to fetch verified tokens";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
