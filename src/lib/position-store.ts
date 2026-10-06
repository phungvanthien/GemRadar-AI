// Persistent store of trade positions + P&L. This is BOTH the open-position
// ledger the exit engine reads/writes AND the win-rate feedback substrate: every
// closed position records why it closed and its realized P&L, so scoring weights
// can be tuned against real outcomes later.
//
// Mirrors social-store.ts: node:fs/promises, atomic write via temp + rename so a
// mid-write worker tick never reads a half-written file. Server-only.

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import type { SellStrategy } from "./settings-store";

const STORE_PATH = path.join(process.cwd(), "gemradar-positions.json");

export type PositionStatus = "open" | "closed";
export type FillKind = "buy" | "sell";

export interface Fill {
  time: string; // ISO
  kind: FillKind;
  // For a sell, the % of the ORIGINAL position this fill represents.
  pct: number;
  priceUsd: number;
  sol: number; // SOL spent (buy) or received (sell); 0 if unknown in dry-run
  tokenAmount: number;
  txSig: string | null; // null in dry-run or on a failed/unsent live tx
  dryRun: boolean;
  // Set when a live tx failed; the fill is recorded for audit but must NOT
  // advance soldPct / remainingPct.
  error?: string;
  // Stable machine code classifying `error` (GuardError.code, or `${status}` for
  // a SendOutcome). Used to tell a genuine "can't be sold" rug signal apart from
  // a transient infra failure — never match the human-readable `error` string.
  errorCode?: string;
  reason?: string; // exit reason for sells: "ladder-t2" | "stop-loss" | ...
}

export interface Position {
  id: string;
  mint: string;
  symbol: string;
  status: PositionStatus;
  mode: "dry-run" | "live";

  entryPriceUsd: number;
  entrySol: number; // SOL committed at entry
  tokenAmount: number; // tokens acquired at entry
  decimals: number; // token decimals, needed to size sell swaps
  entryTime: string; // ISO

  // Immutable snapshot of the strategy at entry — the live settings may change
  // later, but a position is always managed by the plan it was opened under.
  sellStrategy: SellStrategy;

  peakPriceUsd: number; // high-water mark, for trailing stop
  trailingArmed: boolean; // trailing activation latch (survives restarts)

  fills: Fill[];
  soldPct: number; // cumulative % of ORIGINAL position sold (0-100)
  realizedPnlSol: number; // net SOL from sells minus proportional entry cost

  closedReason?: string;
  closedTime?: string;
}

export interface DailyCounter {
  date: string; // YYYY-MM-DD (UTC)
  tradesOpened: number;
}

interface StoreShape {
  positions: Record<string, Position>;
  daily: DailyCounter;
}

async function readStore(): Promise<StoreShape> {
  try {
    const raw = JSON.parse(await readFile(STORE_PATH, "utf8")) as Partial<StoreShape>;
    return {
      positions: raw.positions ?? {},
      daily: raw.daily ?? { date: "", tradesOpened: 0 },
    };
  } catch {
    return { positions: {}, daily: { date: "", tradesOpened: 0 } };
  }
}

async function writeStore(store: StoreShape): Promise<void> {
  await mkdir(path.dirname(STORE_PATH), { recursive: true });
  const tmp = `${STORE_PATH}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await rename(tmp, STORE_PATH);
}

function todayUtc(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export async function getOpenPositions(): Promise<Position[]> {
  const store = await readStore();
  return Object.values(store.positions).filter((p) => p.status === "open");
}

// Wipe the entire ledger — all positions and the daily counter. Used by the
// dashboard's "reset simulation" action. Atomic (temp + rename) like every
// other write, so a concurrent worker tick never reads a half-cleared file.
export async function clearAllPositions(): Promise<void> {
  await writeStore({ positions: {}, daily: { date: "", tradesOpened: 0 } });
}

export async function getAllPositions(): Promise<Position[]> {
  const store = await readStore();
  return Object.values(store.positions);
}

export async function getOpenPositionByMint(mint: string): Promise<Position | null> {
  const store = await readStore();
  return (
    Object.values(store.positions).find(
      (p) => p.mint === mint && p.status === "open",
    ) ?? null
  );
}

// Reads today's counter, resetting it when the UTC date rolls over.
export async function getTradesOpenedToday(now = new Date()): Promise<number> {
  const store = await readStore();
  return store.daily.date === todayUtc(now) ? store.daily.tradesOpened : 0;
}

export interface OpenPositionInput {
  mint: string;
  symbol: string;
  mode: "dry-run" | "live";
  entryPriceUsd: number;
  entrySol: number;
  tokenAmount: number;
  decimals: number;
  sellStrategy: SellStrategy;
  entryFill: Fill;
}

export async function openPosition(input: OpenPositionInput, now = new Date()): Promise<Position> {
  const store = await readStore();
  const id = `${input.mint}-${now.getTime()}`;
  const pos: Position = {
    id,
    mint: input.mint,
    symbol: input.symbol,
    status: "open",
    mode: input.mode,
    entryPriceUsd: input.entryPriceUsd,
    entrySol: input.entrySol,
    tokenAmount: input.tokenAmount,
    decimals: input.decimals,
    entryTime: now.toISOString(),
    sellStrategy: input.sellStrategy,
    peakPriceUsd: input.entryPriceUsd,
    trailingArmed: false,
    fills: [input.entryFill],
    soldPct: 0,
    realizedPnlSol: 0,
  };
  store.positions[id] = pos;

  // Bump the daily counter (reset on date rollover).
  const t = todayUtc(now);
  store.daily =
    store.daily.date === t
      ? { date: t, tradesOpened: store.daily.tradesOpened + 1 }
      : { date: t, tradesOpened: 1 };

  await writeStore(store);
  return pos;
}

// Record a sell fill. A failed live fill (fill.error set) is appended for audit
// but does NOT advance soldPct / realizedPnlSol. Closes the position when the
// cumulative sold reaches the sellable ceiling (100 - manualHoldPercent) or 100.
export async function recordSellFill(
  positionId: string,
  fill: Fill,
  opts: { closeReason?: string; forceClose?: boolean } = {},
  now = new Date(),
): Promise<Position | null> {
  const store = await readStore();
  const pos = store.positions[positionId];
  if (!pos || pos.status === "closed") return null;

  pos.fills.push(fill);

  if (!fill.error) {
    pos.soldPct = Math.min(100, pos.soldPct + fill.pct);
    // Proportional realized P&L: SOL received minus the entry SOL attributable
    // to the fraction sold.
    const entryCostForFill = pos.entrySol * (fill.pct / 100);
    pos.realizedPnlSol += fill.sol - entryCostForFill;
  }

  const sellableCeiling = Math.max(0, 100 - pos.sellStrategy.manualHoldPercent);
  const exhausted = pos.soldPct >= Math.min(100, sellableCeiling) - 1e-9;

  if (opts.forceClose || exhausted) {
    pos.status = "closed";
    pos.closedReason = opts.closeReason ?? fill.reason ?? "exhausted";
    pos.closedTime = now.toISOString();
  }

  store.positions[positionId] = pos;
  await writeStore(store);
  return pos;
}

// Update the high-water mark + trailing-armed latch during a monitor tick.
export async function updatePeak(
  positionId: string,
  currentPriceUsd: number,
  trailingArmed: boolean,
): Promise<void> {
  const store = await readStore();
  const pos = store.positions[positionId];
  if (!pos || pos.status === "closed") return;
  let changed = false;
  if (currentPriceUsd > pos.peakPriceUsd) {
    pos.peakPriceUsd = currentPriceUsd;
    changed = true;
  }
  if (trailingArmed && !pos.trailingArmed) {
    pos.trailingArmed = true;
    changed = true;
  }
  if (changed) {
    store.positions[positionId] = pos;
    await writeStore(store);
  }
}

// ── Mandate accounting helpers ────────────────────────────────────────
// These feed the capital-mandate layer (src/lib/mandate.ts). Kept here because
// they read the same ledger; all are cheap reductions over the store.

// Σ entrySol of OPEN positions — the capital currently "in the market".
export async function getDeployedSol(): Promise<number> {
  const open = await getOpenPositions();
  return open.reduce((s, p) => s + p.entrySol, 0);
}

// Σ realizedPnlSol across ALL positions (open + closed). The lifetime realized
// P&L of the mandate.
export async function getTotalRealizedPnlSol(): Promise<number> {
  const all = await getAllPositions();
  return all.reduce((s, p) => s + p.realizedPnlSol, 0);
}

// Realized P&L (SOL) from advancing sell fills whose time falls on the given UTC
// day. Used for the mandate's daily-loss limit. Mirrors the per-fill P&L math in
// recordSellFill: SOL received minus the entry cost attributable to the fraction
// sold. Errored (non-advancing) and bookkeeping ("reconcile") fills are skipped.
export async function getRealizedPnlToday(now = new Date()): Promise<number> {
  const all = await getAllPositions();
  const day = todayUtc(now);
  let sum = 0;
  for (const pos of all) {
    for (const f of pos.fills) {
      if (f.kind !== "sell" || f.error || f.reason === "reconcile") continue;
      if (f.time.slice(0, 10) !== day) continue;
      const entryCostForFill = pos.entrySol * (f.pct / 100);
      sum += f.sol - entryCostForFill;
    }
  }
  return sum;
}

export function computeUnrealizedPnlSol(pos: Position, currentPriceUsd: number): number {
  if (pos.entryPriceUsd <= 0) return 0;
  const remainingPct = Math.max(0, 100 - pos.soldPct) / 100;
  const remainingEntrySol = pos.entrySol * remainingPct;
  const currentValueSol = remainingEntrySol * (currentPriceUsd / pos.entryPriceUsd);
  return currentValueSol - remainingEntrySol;
}

// Error codes that genuinely mean "this token cannot be sold" — the only signals
// that may count toward a rugpull write-off. Everything else (transient Jupiter
// host/HTTP failures, RPC hiccups, and especially "unknown" outcomes where the tx
// MAY have landed) is infrastructure noise and must NOT be read as a rug.
//
//  - quote-no-route : Jupiter has no swap route back to SOL (classic rug symptom)
//  - price-impact   : the only route left would move price past the cap (dead pool)
//  - failed:*       : the swap tx was provably rejected on-chain (SendOutcome
//                     "failed"). "unknown:*" is deliberately excluded.
export function isRugSellSignal(f: Fill): boolean {
  if (!f.error) return false;
  const code = f.errorCode;
  if (!code) return false; // unclassified → treat as transient, never a rug
  if (code === "quote-no-route" || code === "price-impact") return true;
  if (code.startsWith("failed:")) return true;
  return false;
}

// How many "token can't be sold" signals have accrued back-to-back since the last
// successful (advancing) fill. Derived from the fills log so the count survives a
// worker restart. A rugpulled token produces a run of no-route / price-impact /
// on-chain-rejected sells; once this run reaches a threshold the exit engine
// writes the position off.
//
// CRITICAL: only genuine rug signals (see isRugSellSignal) are counted. A
// transient infra failure between rug signals is SKIPPED (it neither increments
// the run nor resets it) so a Jupiter outage can't manufacture a false rugpull,
// and a flaky tick in the middle of a real rug can't mask it. Any advancing
// (non-errored) sell resets the run to 0.
export function consecutiveSellFails(pos: Position): number {
  let run = 0;
  for (let i = pos.fills.length - 1; i >= 0; i--) {
    const f = pos.fills[i];
    if (f.kind !== "sell") continue;
    if (f.reason === "reconcile") continue; // bookkeeping, not a trade attempt
    if (!f.error) break; // an advancing (successful) sell ends the run
    if (isRugSellSignal(f)) {
      run += 1;
    }
    // else: transient infra failure — skip it, don't count and don't break.
  }
  return run;
}

// Write a position off as a total loss on the UNSOLD remainder — used when a
// token can no longer be sold (rugpull: no swap route or price impact too high).
// The remaining entry capital is booked as a realized loss so mandate equity,
// drawdown and the P&L curve reflect reality, and the position is closed so its
// slot and deployed capital are freed for new entries. The moon-bag hold is NOT
// honored here: a rugpulled token's "hold" is worthless, so the full remaining
// position is written off.
export async function writeOffPosition(
  positionId: string,
  reason = "rugpull",
  now = new Date(),
): Promise<Position | null> {
  const store = await readStore();
  const pos = store.positions[positionId];
  if (!pos || pos.status === "closed") return null;

  const remainingPct = Math.max(0, 100 - pos.soldPct);
  const lostSol = pos.entrySol * (remainingPct / 100);

  pos.fills.push({
    time: now.toISOString(),
    kind: "sell",
    pct: remainingPct,
    priceUsd: 0, // sold for nothing
    sol: 0, // recovered nothing
    tokenAmount: 0,
    txSig: null,
    dryRun: pos.mode !== "live",
    reason,
  });

  pos.soldPct = 100;
  pos.realizedPnlSol -= lostSol;
  pos.status = "closed";
  pos.closedReason = reason;
  pos.closedTime = now.toISOString();

  store.positions[positionId] = pos;
  await writeStore(store);
  return pos;
}

// Which ladder tier ids have already been filled — derived from the fills log so
// a worker restart never double-sells a tier.
export function filledTierIds(pos: Position): Set<string> {
  const ids = new Set<string>();
  for (const f of pos.fills) {
    if (f.kind === "sell" && !f.error && f.reason?.startsWith("ladder-")) {
      ids.add(f.reason.slice("ladder-".length));
    }
  }
  return ids;
}

// A position needs reconciliation when its most recent fill is an ambiguous
// ("unknown:...") live sell: the tx may or may not have executed, so the ledger
// cannot be trusted until the on-chain balance is checked.
export function needsReconcile(pos: Position): boolean {
  const last = pos.fills[pos.fills.length - 1];
  return (
    pos.mode === "live" &&
    last?.kind === "sell" &&
    typeof last.error === "string" &&
    last.error.startsWith("unknown:")
  );
}

// Reconcile the ledger against the actual on-chain token balance after an
// ambiguous sell. We recompute how much of the ORIGINAL position is still held
// on-chain and set soldPct to match reality; this corrects a sell that silently
// did (or didn't) land. Returns the updated position.
//
// onChainUiAmount is the real balance from getTokenBalance (UI units). The
// position's entry tokenAmount is the reference for 100%.
export async function reconcileFromChain(
  positionId: string,
  onChainUiAmount: number,
  now = new Date(),
): Promise<Position | null> {
  const store = await readStore();
  const pos = store.positions[positionId];
  if (!pos || pos.status === "closed") return null;

  const heldPct = pos.tokenAmount > 0
    ? Math.min(100, Math.max(0, (onChainUiAmount / pos.tokenAmount) * 100))
    : 0;
  const reconciledSoldPct = Math.min(100, Math.max(0, 100 - heldPct));

  pos.soldPct = reconciledSoldPct;
  pos.fills.push({
    time: now.toISOString(),
    kind: "sell",
    pct: 0, // bookkeeping marker, not an actual trade
    priceUsd: 0,
    sol: 0,
    tokenAmount: onChainUiAmount,
    txSig: null,
    dryRun: false,
    reason: "reconcile",
  });

  const sellableCeiling = Math.max(0, 100 - pos.sellStrategy.manualHoldPercent);
  if (pos.soldPct >= Math.min(100, sellableCeiling) - 1e-9) {
    pos.status = "closed";
    pos.closedReason = "reconciled-exhausted";
    pos.closedTime = now.toISOString();
  }

  store.positions[positionId] = pos;
  await writeStore(store);
  return pos;
}
