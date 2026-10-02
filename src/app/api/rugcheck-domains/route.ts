import { NextResponse } from "next/server";
import { getRugcheckDomains, lookupRugcheckDomain } from "@/lib/rugcheck";

export const dynamic = "force-dynamic";

// A .token domain, e.g. "mytoken.token". Letters, digits, hyphens, dots.
const DOMAIN_RE = /^[a-zA-Z0-9.-]{1,253}$/;

// GET /api/rugcheck-domains?page=1&limit=20 -> a page of verified .token
// domains.
// GET /api/rugcheck-domains?lookup=mytoken.token -> resolve one domain to its
// mint (404 when unknown).
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const lookup = params.get("lookup");

    if (lookup !== null) {
      if (!DOMAIN_RE.test(lookup)) {
        return NextResponse.json(
          { error: `Invalid .token domain: ${lookup || "(empty)"}` },
          { status: 400 },
        );
      }
      const domain = await lookupRugcheckDomain(lookup);
      if (!domain) {
        return NextResponse.json(
          { error: "Domain not found" },
          { status: 404 },
        );
      }
      return NextResponse.json({ domain, updatedAt: new Date().toISOString() });
    }

    const rawPage = Number(params.get("page"));
    const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
    const rawLimit = Number(params.get("limit"));
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20;

    const { domains, nextPage } = await getRugcheckDomains(page, limit);
    return NextResponse.json({ domains, nextPage, updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("[/api/rugcheck-domains]", error);
    const message = error instanceof Error ? error.message : "Failed to fetch domains";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
