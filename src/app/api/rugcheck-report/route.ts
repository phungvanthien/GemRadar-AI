import { NextResponse } from "next/server";
import { getRugcheckReport } from "@/lib/rugcheck";

export const dynamic = "force-dynamic";

// Base58 (Solana addresses exclude 0, O, I, l), typically 32-44 chars.
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// GET /api/rugcheck-report?mint=<mint> -> full RugCheck report for one token
// (holder concentration, LP locks, insider networks). Deep-dive on a single
// candidate; use /api/solana-gems for batch scoring.
export async function GET(request: Request) {
  try {
    const mint = new URL(request.url).searchParams.get("mint");
    if (!mint || !MINT_RE.test(mint)) {
      return NextResponse.json(
        { error: `Invalid or missing Solana mint address: ${mint ?? "(missing)"}` },
        { status: 400 },
      );
    }

    const report = await getRugcheckReport(mint);
    if (!report) {
      return NextResponse.json(
        { error: "No RugCheck report available for this token" },
        { status: 404 },
      );
    }

    return NextResponse.json({ report, updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("[/api/rugcheck-report]", error);
    const message = error instanceof Error ? error.message : "Failed to fetch report";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
