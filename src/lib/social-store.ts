// Bridge between the Next.js gem scan and the social worker
// (scripts/tg-worker/worker.py). Three JSON files on disk are the contract:
//
//  - watchlist.json     (Next.js writes, worker reads): which mints to track and
//                        their Telegram link + status (active/fail/sold).
//  - social-scores.json (worker writes, Next.js reads): Telegram socialScore per
//                        mint (members, msg/hour, group age).
//
// Bot & spam filtering (spam-filter.ts) is applied at merge time: raw scores
// from both workers are discounted by the spam/authenticity verdict before
// they reach gem-score.ts. This prevents inflated social scores driven by
// bot activity from boosting a gem's overall rating.
//  - x-scores.json      (worker writes, Next.js reads): X/Twitter buzz xScore per
//                        mint (tweet count, unique authors, engagement, freshness)
//                        sourced from Nitter RSS — no API key required.
//
// Both score files are written by the SAME worker.py in a single pass.
// Server-only (uses node:fs). Every read degrades to {} so a missing or
// slow worker never breaks a gem scan.

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import type { SocialSignals } from "./gem-score";
import {
  filterTelegramGroup,
  filterXAccount,
  applyGroupSpamDiscount,
  applyXSpamDiscount,
  type TelegramGroupSignals,
} from "./spam-filter";

const WORKER_DIR = path.join(process.cwd(), "scripts", "tg-worker");
const WATCHLIST_PATH = path.join(WORKER_DIR, "watchlist.json");
const SOCIAL_SCORES_PATH = path.join(process.cwd(), "scripts", "social-scores.json");
const X_SCORES_PATH = path.join(process.cwd(), "scripts", "x-scores.json");

export type WatchStatus = "active" | "fail" | "sold";

export interface WatchEntry {
  telegram: string | null;
  symbol: string;
  status: WatchStatus;
}

export interface SocialScoreEntry {
  socialScore: number;
  members: number | null;
  msgPerHour: number | null;
  groupAgeDays: number | null;
  telegram: string;
  joinedAt: string;
  leftAt?: string;
  // Optional spam-filter signals written by the worker (when available).
  // Used by mergeSignals to discount bot-inflated scores.
  onlineCount?: number | null;
  forwardedShare?: number | null;
  anonymousShare?: number | null;
  contractShare?: number | null;
  uniqueSenderRatio?: number | null;
  // Post-filter fields (set by mergeSignals, not the worker)
  spamFlags?: string[];
  spamMultiplier?: number;
}

// Written by scripts/tg-worker/worker.py — the combined social worker.
// x.source = "nitter"  → scraped via Nitter RSS (no API key needed).
// x.source = "scrape"  → legacy, from the old x-worker/twitter_scraper.ts.
export interface XScoreEntry {
  xScore: number;
  symbol: string;
  tweetCount: number;
  uniqueAuthors: number;
  avgEngagement: number;
  recentTweets: number;
  searchQuery: string;
  scrapedAt: string;
  source: "nitter" | "scrape";
  error: string | null;
  // Optional account-level signals for spam filtering (added by Nitter scraper).
  accountAgeDays?: number | null;
  followers?: number | null;
  following?: number | null;
  verified?: boolean;
  avgEngagementPerTweet?: number | null;
  // Post-filter fields (set by mergeSignals, not the worker)
  spamFlags?: string[];
  authenticityScore?: number;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

// Combine the TG worker's socialScore and the X buzz worker's xScore into one
// SocialSignals for gem-score.scoreSocial. A mint with either signal is
// "covered"; one with neither returns null.
//
// Spam filtering is applied here:
//  - Telegram: filterTelegramGroup builds a group verdict from aggregate
//    signals (online ratio, msg rate, forwarded/anon share, etc.) and discounts
//    the rawSocialScore proportionally.
//  - X: filterXAccount builds an account verdict from account-level signals
//    (age, follow ratio, engagement rate) and discounts rawXScore proportionally.
//  - Filtered verdicts are written back to the entry objects so callers can
//    surface the flags in the UI / AI context.
function mergeSignals(
  tg: SocialScoreEntry | undefined,
  x: XScoreEntry | undefined,
): SocialSignals | null {
  const signals: SocialSignals = {};

  // ── Telegram ──
  if (tg && typeof tg.socialScore === "number") {
    const groupSignals: TelegramGroupSignals = {
      memberCount: tg.members,
      onlineCount: tg.onlineCount ?? null,
      msgPerHour: tg.msgPerHour,
      groupAgeDays: tg.groupAgeDays,
      forwardedShare: tg.forwardedShare ?? null,
      anonymousShare: tg.anonymousShare ?? null,
      contractShare: tg.contractShare ?? null,
      uniqueSenderRatio: tg.uniqueSenderRatio ?? null,
    };
    const groupVerdict = filterTelegramGroup(groupSignals);
    const discounted = applyGroupSpamDiscount(tg.socialScore, groupVerdict);
    // Write back for UI / logging (mutating the local object is safe — it's a
    // fresh parse from JSON each call).
    tg.spamFlags = groupVerdict.flags;
    tg.spamMultiplier = groupVerdict.scoreMultiplier;
    signals.socialScore = discounted;
  }

  // ── X / Twitter ──
  // Only trust an xScore from a clean scrape (no error).
  if (x && !x.error && typeof x.xScore === "number") {
    const accountVerdict = filterXAccount({
      accountAgeDays: x.accountAgeDays ?? null,
      followers: x.followers ?? null,
      following: x.following ?? null,
      tweetCount: x.tweetCount,
      verified: x.verified ?? false,
      avgEngagementPerTweet: x.avgEngagementPerTweet ?? x.avgEngagement ?? null,
    });
    const discounted = applyXSpamDiscount(x.xScore, accountVerdict);
    // Write back for UI / logging.
    x.spamFlags = accountVerdict.flags;
    x.authenticityScore = accountVerdict.authenticityScore;
    signals.xScore = discounted;
  }

  return "socialScore" in signals || "xScore" in signals ? signals : null;
}

// Read both workers' scores as a lookup usable by gem-score.scoreSocial.
export async function getSocialSignals(
  mint: string,
): Promise<SocialSignals | null> {
  const [tgScores, xScores] = await Promise.all([
    readJson<Record<string, SocialScoreEntry>>(SOCIAL_SCORES_PATH, {}),
    readJson<Record<string, XScoreEntry>>(X_SCORES_PATH, {}),
  ]);
  return mergeSignals(tgScores[mint], xScores[mint]);
}

// Batch variant to avoid reading the files once per mint during a scan.
export async function getSocialSignalsBulk(
  mints: string[],
): Promise<Map<string, SocialSignals>> {
  const [tgScores, xScores] = await Promise.all([
    readJson<Record<string, SocialScoreEntry>>(SOCIAL_SCORES_PATH, {}),
    readJson<Record<string, XScoreEntry>>(X_SCORES_PATH, {}),
  ]);
  const out = new Map<string, SocialSignals>();
  for (const mint of mints) {
    const merged = mergeSignals(tgScores[mint], xScores[mint]);
    if (merged) out.set(mint, merged);
  }
  return out;
}

// Merge tracked mints into watchlist.json for the worker to pick up. Existing
// entries are preserved (status not downgraded) unless the caller overrides it.
export async function upsertWatchlist(
  entries: Array<{ mint: string; telegram: string | null; symbol: string; status?: WatchStatus }>,
): Promise<void> {
  const current = await readJson<Record<string, WatchEntry>>(WATCHLIST_PATH, {});
  for (const e of entries) {
    const prev = current[e.mint];
    current[e.mint] = {
      telegram: e.telegram,
      symbol: e.symbol,
      // Keep an existing terminal status unless explicitly changed; default to
      // active for newly-tracked mints.
      status: e.status ?? prev?.status ?? "active",
    };
  }
  await mkdir(WORKER_DIR, { recursive: true });
  // Atomic write via temp + rename so the worker never reads a partial file.
  const tmp = `${WATCHLIST_PATH}.tmp`;
  await writeFile(tmp, JSON.stringify(current, null, 2), "utf8");
  await rename(tmp, WATCHLIST_PATH);
}

// Mark a mint's project as failed or sold so the worker leaves its channel.
export async function markWatchStatus(
  mint: string,
  status: WatchStatus,
): Promise<void> {
  const current = await readJson<Record<string, WatchEntry>>(WATCHLIST_PATH, {});
  const prev = current[mint];
  if (!prev) return;
  current[mint] = { ...prev, status };
  await mkdir(WORKER_DIR, { recursive: true });
  const tmp = `${WATCHLIST_PATH}.tmp`;
  await writeFile(tmp, JSON.stringify(current, null, 2), "utf8");
  await rename(tmp, WATCHLIST_PATH);
}
