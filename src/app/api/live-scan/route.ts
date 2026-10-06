import { NextResponse } from "next/server";
import { readLiveScanState } from "@/lib/live-scan-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const state = await readLiveScanState();
    return NextResponse.json(state);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read live scan state";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
