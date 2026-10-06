// In-memory ring buffer of recently-seen Solana mints from the RugCheck live
// stream. The stream route (src/app/api/rugcheck-stream/route.ts) records every
// token it observes here; the solana-gems scan route reads the most recent N to
// build a "new mints" scan without the client having to supply a token list.
//
// Scope & limits: this is process-local module state. On a single long-lived
// Node server (next start / self-host) every stream connection in that process
// shares one buffer, which is what we want. On serverless/multi-instance
// deployments each instance has its own buffer and it resets on cold start —
// acceptable because the buffer is a best-effort recent-activity cache, not a
// source of truth. Deduplicated by mint (newest wins), capped at CAPACITY.

export interface RecentMint {
  mint: string;
  symbol: string;
  name: string;
  scoreNormalised: number; // RugCheck 0-100, higher = riskier
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  totalMarketLiquidity: number | null;
  seenAt: number; // epoch ms when recorded
}

const CAPACITY = 200;

// Next.js dev mode isolation fix: use globalThis to share state between routes
const globalAny = globalThis as any;
if (!globalAny.__recentMintsBuffer) {
  globalAny.__recentMintsBuffer = [];
}
const buffer: RecentMint[] = globalAny.__recentMintsBuffer;

export function recordMint(entry: Omit<RecentMint, "seenAt">): void {
  const seenAt = Date.now();
  // Drop any existing entry for this mint so the newest report wins and the
  // mint moves to the front.
  const existingIdx = buffer.findIndex((e) => e.mint === entry.mint);
  if (existingIdx !== -1) buffer.splice(existingIdx, 1);

  buffer.unshift({ ...entry, seenAt });
  if (buffer.length > CAPACITY) buffer.length = CAPACITY;
}

export interface RecentMintFilter {
  // Only return mints with RugCheck score at or below this (lower = safer).
  maxScore?: number;
  // Only return mints with at least this much reported liquidity (USD).
  minLiquidity?: number;
  // Only return mints seen within this many milliseconds.
  maxAgeMs?: number;
  // Require revoked mint authority.
  requireMintRevoked?: boolean;
  // Require revoked freeze authority.
  requireFreezeRevoked?: boolean;
}

// Read the most recent mints, newest-first, after applying optional filters.
export function getRecentMints(limit = 15, filter: RecentMintFilter = {}): RecentMint[] {
  const now = Date.now();
  const out: RecentMint[] = [];
  for (const e of buffer) {
    if (out.length >= limit) break;
    if (filter.maxScore != null && e.scoreNormalised > filter.maxScore) continue;
    if (
      filter.minLiquidity != null &&
      (e.totalMarketLiquidity == null || e.totalMarketLiquidity < filter.minLiquidity)
    ) {
      continue;
    }
    if (filter.maxAgeMs != null && now - e.seenAt > filter.maxAgeMs) continue;
    if (filter.requireMintRevoked && !e.mintAuthorityRevoked) continue;
    if (filter.requireFreezeRevoked && !e.freezeAuthorityRevoked) continue;
    out.push(e);
  }
  return out;
}

export function recentMintCount(): number {
  return buffer.length;
}
