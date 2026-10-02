import { NextResponse } from "next/server";
import { getNetworkEconomics, getNodeStatus } from "@/lib/flux";

export const dynamic = "force-dynamic";

// GET /api/solana-status              -> node/cluster health
// GET /api/solana-status?economics=1  -> also include network economics
export async function GET(request: Request) {
  try {
    const includeEconomics =
      new URL(request.url).searchParams.get("economics") === "1";

    const [status, economics] = await Promise.all([
      getNodeStatus(),
      includeEconomics ? getNetworkEconomics() : Promise.resolve(null),
    ]);

    return NextResponse.json(
      {
        ...status,
        ...(economics ? { economics } : {}),
        updatedAt: new Date().toISOString(),
      },
      { status: status.healthy ? 200 : 503 },
    );
  } catch (error) {
    console.error("[/api/solana-status]", error);
    const message = error instanceof Error ? error.message : "Failed to fetch node status";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
