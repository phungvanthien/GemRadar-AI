import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { SolanaGemInput } from "./ai";

const STORE_PATH = path.join(process.cwd(), "gemradar-live-scan.json");

export interface LiveScanState {
  status: "idle" | "scanning" | "analyzing" | "completed" | "error";
  updatedAt: string;
  tokens: {
    mint: string;
    symbol: string;
    name: string;
  }[];
  enrichedInputs?: SolanaGemInput[];
  results?: any[];
  error?: string;
}

const DEFAULT_STATE: LiveScanState = {
  status: "idle",
  updatedAt: new Date().toISOString(),
  tokens: [],
};

export async function readLiveScanState(): Promise<LiveScanState> {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    return JSON.parse(raw) as LiveScanState;
  } catch {
    return DEFAULT_STATE;
  }
}

export async function writeLiveScanState(state: LiveScanState): Promise<void> {
  try {
    await mkdir(path.dirname(STORE_PATH), { recursive: true });
    const tmp = `${STORE_PATH}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
    await rename(tmp, STORE_PATH);
  } catch (e) {
    console.error("Failed to write live scan state:", e);
  }
}
