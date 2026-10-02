import { NextResponse } from "next/server";
import { getRugcheckValidation, isRugcheckDomainEligible } from "@/lib/rugcheck";

export const dynamic = "force-dynamic";

// Base58 (Solana addresses exclude 0, O, I, l), typically 32-44 chars.
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// GET /api/rugcheck-validation?mint=<mint> -> a token's RugCheck verification
// status (validated flag, official website/socials) plus its .token domain
// eligibility. Both signals degrade independently to their conservative default
// (not validated / not eligible) rather than failing the request.
export async function GET(request: Request) {
  try {
    const mint = new URL(request.url).searchParams.get("mint");
    if (!mint || !MINT_RE.test(mint)) {
      return NextResponse.json(
        { error: `Invalid or missing Solana mint address: ${mint ?? "(missing)"}` },
        { status: 400 },
      );
    }

    const [validation, domainEligible] = await Promise.all([
      getRugcheckValidation(mint),
      isRugcheckDomainEligible(mint),
    ]);

    return NextResponse.json({
      validation,
      domainEligible,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[/api/rugcheck-validation]", error);
    const message = error instanceof Error ? error.message : "Failed to fetch validation";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
