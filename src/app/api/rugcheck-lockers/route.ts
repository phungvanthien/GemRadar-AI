import { NextResponse } from "next/server";
import {
  getRugcheckLockers,
  getRugcheckFluxLockers,
  getRugcheckVotes,
} from "@/lib/rugcheck";

export const dynamic = "force-dynamic";

// Base58 (Solana addresses exclude 0, O, I, l), typically 32-44 chars.
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// GET /api/rugcheck-lockers?mint=<mint> -> a token's locked-liquidity picture:
// standard locker vaults, FluxBeam vaults, and the community vote tally. Locked
// LP is one of the strongest anti-rug signals; the vote tally is a crowd-
// sentiment read. Each signal degrades to empty/zero independently.
export async function GET(request: Request) {
  try {
    const mint = new URL(request.url).searchParams.get("mint");
    if (!mint || !MINT_RE.test(mint)) {
      return NextResponse.json(
        { error: `Invalid or missing Solana mint address: ${mint ?? "(missing)"}` },
        { status: 400 },
      );
    }

    const [lockers, fluxLockers, votes] = await Promise.all([
      getRugcheckLockers(mint),
      getRugcheckFluxLockers(mint),
      getRugcheckVotes(mint),
    ]);

    return NextResponse.json({
      lockers,
      fluxLockers,
      votes,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[/api/rugcheck-lockers]", error);
    const message = error instanceof Error ? error.message : "Failed to fetch lockers";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
