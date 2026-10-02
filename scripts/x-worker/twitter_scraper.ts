#!/usr/bin/env node
/**
 * X (Twitter) buzz scraper — the FREE social-signal worker for AlphaHunter.
 *
 * Analogue of scripts/tg-worker: it reads the gem scan's watchlist.json, searches
 * X for each token's `$SYMBOL`, measures how much it's being talked about, turns
 * that into a 0-100 `xScore`, and writes x-scores.json. The Next.js gem score
 * (src/lib/gem-score.ts, Social category) reads that file back via social-store.ts.
 *
 * Why scrape instead of the official API? src/lib/x.ts uses the PAID v2 API on a
 * token's *known official handle* (reach + verified). This worker needs no key:
 * it measures organic BUZZ around the ticker (tweet count, unique authors, recent
 * engagement) — the "X active / organic engagement" green flag in gem-score.md.
 * The two are complementary; either can feed xScore.
 *
 * ⚠️ Risk: scraping X with a logged-in account can get that account rate-limited
 * or suspended. Use a THROWAWAY account's cookies (cookies.json), keep the token
 * cap low, and leave the human-like delays in. You run this at your own risk.
 *   See README.md.
 *
 * Run (after `npm i -D playwright` + exporting cookies.json): see README.md
 *   npx tsx scripts/x-worker/twitter_scraper.ts            # one pass over the watchlist
 *   npx tsx scripts/x-worker/twitter_scraper.ts --watch    # re-scan on a schedule
 */

import { chromium, type BrowserContext, type Page } from "playwright";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  watchFile,
} from "node:fs";
import path from "node:path";

// --- Paths. Mirror tg-worker's file contract. ---
const WORKER_DIR = __dirname;
const ROOT = path.resolve(WORKER_DIR, "..", "..");
const WATCHLIST_PATH = path.join(ROOT, "scripts", "tg-worker", "watchlist.json");
const X_SCORES_PATH = path.join(ROOT, "scripts", "x-scores.json");
const COOKIES_PATH = path.join(WORKER_DIR, "cookies.json");
const CONFIG_PATH = path.join(ROOT, "social-monitor.config.json");

// --- Types ---

// watchlist.json entry (Next.js writes this; worker.py and this worker read it).
interface WatchEntry {
  telegram: string | null;
  symbol: string;
  status: "active" | "fail" | "sold";
}
type Watchlist = Record<string, WatchEntry>;

interface ScrapedTweet {
  id: string;
  text: string;
  authorHandle: string;
  timestamp: string; // ISO-8601 from the tweet's <time datetime>
  likes: number;
  retweets: number;
  replies: number;
}

// x-scores.json entry (worker writes; src/lib/social-store.ts reads).
interface XScoreEntry {
  xScore: number; // 0-100 buzz score fed into the gem Social category
  symbol: string;
  tweetCount: number; // distinct tweets collected for $SYMBOL
  uniqueAuthors: number; // distinct handles — a crude bot/sock-puppet smell test
  avgEngagement: number; // mean (likes+RT+replies) across collected tweets
  recentTweets: number; // tweets from the last 24h (freshness)
  searchQuery: string; // e.g. "$BONK"
  scrapedAt: string; // ISO-8601
  source: "scrape";
  error: string | null;
}
type XScores = Record<string, XScoreEntry>;

// --- Config (buzz-scoring + rate-limit knobs). Reads the `x` section of
// social-monitor.config.json where it overlaps; everything else has safe
// defaults so a missing config never breaks a run. ---
interface ScraperConfig {
  maxTokensPerRun: number; // cap scrapes per pass (rate-limit safety)
  scrollDurationMs: number; // how long to scroll each token's results
  hardTimeoutMs: number; // absolute cap per token
  rescanIntervalMinutes: number; // --watch cadence
  headless: boolean;
}

const DEFAULT_CONFIG: ScraperConfig = {
  maxTokensPerRun: 10,
  scrollDurationMs: 25_000,
  hardTimeoutMs: 40_000,
  rescanIntervalMinutes: 60,
  headless: true,
};

function loadConfig(): ScraperConfig {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Record<string, unknown>;
    const x = (raw.x ?? {}) as Record<string, unknown>;
    const num = (v: unknown, d: number) =>
      typeof v === "number" && Number.isFinite(v) ? v : d;
    return {
      // Reuse x.maxAccountsPerRun as the per-run token cap when present.
      maxTokensPerRun: num(x.maxAccountsPerRun, DEFAULT_CONFIG.maxTokensPerRun),
      rescanIntervalMinutes: num(x.pollIntervalMinutes, DEFAULT_CONFIG.rescanIntervalMinutes),
      scrollDurationMs: DEFAULT_CONFIG.scrollDurationMs,
      hardTimeoutMs: DEFAULT_CONFIG.hardTimeoutMs,
      headless: DEFAULT_CONFIG.headless,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

// --- Small helpers ---

function nowIso(): string {
  return new Date().toISOString();
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

// Atomic write (temp + rename) so a concurrent reader never sees a half file —
// same discipline as tg-worker's write_json and social-store's upsertWatchlist.
function writeJsonAtomic(file: string, data: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, file);
}

// Parse X's compact engagement counts: "1.2K" → 1200, "3M" → 3_000_000, "" → 0.
function parseCount(raw: string | null): number {
  if (!raw) return 0;
  const s = raw.trim().replace(/,/g, "");
  const m = s.match(/^([\d.]+)\s*([KMB])?$/i);
  if (!m) {
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  const n = parseFloat(m[1]);
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] || "").toLowerCase()] ?? 1;
  return Math.round(n * mult);
}

// --- xScore: turn scraped buzz into 0-100. Signals-only, like src/lib/x.ts: it
// measures how much a ticker is being talked about and whether that talk looks
// organic. It does NOT claim to detect bots reliably — unique-author ratio is a
// weak smell test, not proof. Missing signals score 0 for their component so a
// quiet ticker can't fake a high score.
//
//   Tweet volume      35 pts, saturating ~40 tweets collected
//   Unique authors    25 pts, saturating ~25 distinct handles (breadth of talk)
//   Avg engagement    25 pts, saturating ~50 (likes+RT+replies per tweet)
//   Freshness         15 pts, share of tweets from the last 24h
//
// A ticker with lots of tweets but very few distinct authors (sock-puppet smell)
// is capped at 50 — the same caution src/lib/x.ts applies to brand-new accounts.
function computeXScore(stats: {
  tweetCount: number;
  uniqueAuthors: number;
  avgEngagement: number;
  recentTweets: number;
}): number {
  const { tweetCount, uniqueAuthors, avgEngagement, recentTweets } = stats;
  let score = 0;

  if (tweetCount > 0) score += Math.min(tweetCount / 40, 1) * 35;
  if (uniqueAuthors > 0) score += Math.min(uniqueAuthors / 25, 1) * 25;
  if (avgEngagement > 0) score += Math.min(avgEngagement / 50, 1) * 25;
  if (tweetCount > 0) score += Math.min(recentTweets / tweetCount, 1) * 15;

  // Sock-puppet caution: many tweets, almost all from the same few accounts.
  if (tweetCount >= 10 && uniqueAuthors / tweetCount < 0.3) {
    score = Math.min(score, 50);
  }

  return Math.round(Math.min(Math.max(score, 0), 100) * 10) / 10;
}

// --- Browser auth. Loads a throwaway account's cookies (exported from a browser
// extension, same shape the sample used) so search returns the Latest tab.
// Degrades to logged-out search if no cookies — fewer results, still usable. ---
function loadCookies(): Record<string, unknown>[] {
  if (!existsSync(COOKIES_PATH)) return [];
  const raw = readJson<Record<string, unknown>[]>(COOKIES_PATH, []);
  return raw.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires:
      typeof c.expirationDate === "number" ? Math.floor(c.expirationDate) : undefined,
    httpOnly: Boolean(c.httpOnly),
    secure: Boolean(c.secure),
    sameSite:
      c.sameSite === "no_restriction"
        ? "None"
        : c.sameSite === "strict"
          ? "Strict"
          : "Lax",
  }));
}

async function openContext(headless: boolean): Promise<{ context: BrowserContext; page: Page; close: () => Promise<void> }> {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const cookies = loadCookies();
  if (cookies.length > 0) await context.addCookies(cookies as never);

  const page = await context.newPage();
  await page.goto("https://x.com/explore", { timeout: 30_000 });
  await page.waitForTimeout(6_000);

  const close = async () => {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  };
  return { context, page, close };
}

// --- Scrape one ticker's buzz. Searches $SYMBOL on the Latest tab, scrolls to
// collect distinct tweets, and reduces them to the stats computeXScore needs. ---
async function scrapeTicker(
  page: Page,
  symbol: string,
  cfg: ScraperConfig,
): Promise<Omit<XScoreEntry, "symbol">> {
  const query = `$${symbol}`;
  const base: Omit<XScoreEntry, "symbol"> = {
    xScore: 0,
    tweetCount: 0,
    uniqueAuthors: 0,
    avgEngagement: 0,
    recentTweets: 0,
    searchQuery: query,
    scrapedAt: nowIso(),
    source: "scrape",
    error: null,
  };

  const startedAt = Date.now();
  try {
    const searchUrl = `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`;
    await page.goto(searchUrl, { timeout: 30_000 });
    await page.waitForTimeout(2_500);

    const tweets = new Map<string, ScrapedTweet>();
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;

    while (Date.now() - startedAt < cfg.scrollDurationMs) {
      const cards = await page.locator('[data-testid="tweet"]').all();
      for (const card of cards) {
        try {
          const text =
            (await card.locator('[data-testid="tweetText"]').first().textContent().catch(() => "")) ?? "";
          const handleRaw =
            (await card.locator('[data-testid="User-Name"] a').first().textContent().catch(() => "")) ?? "";
          const timestamp =
            (await card.locator("time").first().getAttribute("datetime").catch(() => "")) ?? "";
          const likes = parseCount(
            await card.locator('[data-testid="like"]').first().textContent().catch(() => "0"),
          );
          const retweets = parseCount(
            await card.locator('[data-testid="retweet"]').first().textContent().catch(() => "0"),
          );
          const replies = parseCount(
            await card.locator('[data-testid="reply"]').first().textContent().catch(() => "0"),
          );

          const handle = handleRaw.trim();
          const id = `${handle}_${timestamp}_${text.slice(0, 40)}`;
          if (text && !tweets.has(id)) {
            tweets.set(id, { id, text, authorHandle: handle, timestamp, likes, retweets, replies });
          }
        } catch {
          // One malformed card shouldn't abort the whole ticker.
          continue;
        }
      }

      await page.keyboard.press("PageDown");
      // Human-like jitter between scrolls.
      await page.waitForTimeout(300 + Math.random() * 700);

      if (Date.now() - startedAt > cfg.hardTimeoutMs) break;
    }

    const list = [...tweets.values()];
    const uniqueAuthors = new Set(list.map((t) => t.authorHandle).filter(Boolean)).size;
    const engagementSum = list.reduce((s, t) => s + t.likes + t.retweets + t.replies, 0);
    const avgEngagement = list.length > 0 ? engagementSum / list.length : 0;
    const recentTweets = list.filter((t) => {
      const ms = Date.parse(t.timestamp);
      return Number.isFinite(ms) && ms >= dayAgo;
    }).length;

    const stats = {
      tweetCount: list.length,
      uniqueAuthors,
      avgEngagement: Math.round(avgEngagement * 10) / 10,
      recentTweets,
    };

    return {
      ...base,
      ...stats,
      xScore: computeXScore(stats),
      scrapedAt: nowIso(),
    };
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : String(e), scrapedAt: nowIso() };
  }
}

// --- One pass over the active watchlist. ---
async function runOnce(cfg: ScraperConfig): Promise<void> {
  const watchlist = readJson<Watchlist>(WATCHLIST_PATH, {});
  const scores = readJson<XScores>(X_SCORES_PATH, {});

  const active = Object.entries(watchlist)
    .filter(([, e]) => e && e.status === "active" && e.symbol)
    .slice(0, cfg.maxTokensPerRun);

  if (active.length === 0) {
    console.log("watchlist.json has no active tokens — nothing to do. Run a gem scan first.");
    return;
  }

  console.log(`\n=== X buzz scrape — ${active.length} token(s) @ ${nowIso()} ===`);
  const { page, close } = await openContext(cfg.headless);
  try {
    for (const [mint, entry] of active) {
      const result = await scrapeTicker(page, entry.symbol, cfg);
      scores[mint] = { ...result, symbol: entry.symbol };
      // Persist after each token so a mid-run crash keeps earlier results.
      writeJsonAtomic(X_SCORES_PATH, scores);
      const tag = `${entry.symbol} (${mint.slice(0, 6)}…)`;
      if (result.error) {
        console.log(`  ✗ ${tag}: ${result.error}`);
      } else {
        console.log(
          `  ✓ ${tag}: xScore=${result.xScore} tweets=${result.tweetCount} ` +
            `authors=${result.uniqueAuthors} avgEng=${result.avgEngagement} recent=${result.recentTweets}`,
        );
      }
    }
  } finally {
    await close();
  }
  console.log("Done.");
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const watch = process.argv.includes("--watch");

  console.log("AlphaHunter X buzz scraper");
  console.log(`  watchlist: ${WATCHLIST_PATH}`);
  console.log(`  output:    ${X_SCORES_PATH}`);
  console.log(`  cookies:   ${existsSync(COOKIES_PATH) ? "loaded" : "NONE (logged-out search)"}`);

  await runOnce(cfg);

  if (!watch) return;

  // --watch: re-scan whenever the watchlist changes, and on a fixed cadence as a
  // floor so new tokens get picked up even if the file mtime doesn't fire.
  let running = false;
  const guarded = async () => {
    if (running) return;
    running = true;
    try {
      await runOnce(cfg);
    } catch (e) {
      console.error("scan error:", e);
    } finally {
      running = false;
    }
  };

  if (existsSync(WATCHLIST_PATH)) {
    watchFile(WATCHLIST_PATH, { interval: 5_000 }, () => void guarded());
  }
  const everyMs = cfg.rescanIntervalMinutes * 60_000;
  console.log(`\nWatching watchlist.json and re-scanning every ${cfg.rescanIntervalMinutes} min. Ctrl+C to stop.`);
  setInterval(() => void guarded(), everyMs);
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
