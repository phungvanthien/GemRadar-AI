import { NextResponse } from "next/server";
import { getRugcheckInsiderGraph } from "@/lib/rugcheck";

export const dynamic = "force-dynamic";

// Base58 (Solana addresses exclude 0, O, I, l), typically 32-44 chars.
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// GET /api/rugcheck-insiders?mint=<mint> -> the account node/link topology of a
// token's insider networks. Deep-dive on a single candidate; the aggregate
// counts live in /api/rugcheck-report's insiderNetworks.
export async function GET(request: Request) {
  try {
    const mint = new URL(request.url).searchParams.get("mint");
    if (!mint || !MINT_RE.test(mint)) {
      return NextResponse.json(
        { error: `Invalid or missing Solana mint address: ${mint ?? "(missing)"}` },
        { status: 400 },
      );
    }

    const networks = await getRugcheckInsiderGraph(mint);
    return NextResponse.json({ networks, updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("[/api/rugcheck-insiders]", error);
    const message = error instanceof Error ? error.message : "Failed to fetch insider graph";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
