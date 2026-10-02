// X (Twitter) API v2 client — server-side only.
//
// Endpoints (verified reachable; return 401 without a valid token, not 404):
//   GET https://api.x.com/2/users/by/username/:username?user.fields=public_metrics,created_at,verified
//   GET https://api.x.com/2/users/:id/tweets?max_results=N&tweet.fields=public_metrics,created_at
//
// Auth: `Authorization: Bearer <X_BEARER_TOKEN>` (paid tier — the official v2 API
// has no free read access). Disabled unless a token is set AND x.enabled +
// x.source==="official" in social-monitor.config.json. Every failure degrades to
// null so a scan never breaks over X being unavailable/rate-limited.

const BASE_URL = "https://api.x.com/2";
const DEFAULT_TIMEOUT_MS = 10_000;

function bearer(): string | null {
  return process.env.X_BEARER_TOKEN ?? null;
}

// Parse an X/Twitter handle from a link or @mention. Accepts x.com/<h>,
// twitter.com/<h>, @<h>, or a bare handle. Strips query strings and trailing
// slashes. Returns null for status/intent/share URLs (not a profile).
const _HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

export function parseXHandle(link: string): string | null {
  if (!link) return null;
  let s = link.trim();
  const at = s.match(/^@([A-Za-z0-9_]{1,15})$/);
  if (at) return at[1];

  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  const m = s.match(/^(?:x\.com|twitter\.com)\/([^/?#]+)/i);
  if (m) {
    const handle = m[1];
    // Reserved paths that aren't profiles.
    if (["i", "intent", "share", "home", "search", "hashtag"].includes(handle.toLowerCase())) {
      return null;
    }
    return _HANDLE_RE.test(handle) ? handle : null;
  }
  return _HANDLE_RE.test(s) ? s : null;
}

interface RawUser {
  id?: string;
  name?: string;
  username?: string;
  verified?: boolean;
  created_at?: string;
  public_metrics?: {
    followers_count?: number;
    following_count?: number;
    tweet_count?: number;
    listed_count?: number;
  };
}

interface RawTweet {
  public_metrics?: {
    like_count?: number;
    retweet_count?: number;
    reply_count?: number;
    quote_count?: number;
  };
  created_at?: string;
}

export interface XProfileMetrics {
  handle: string;
  followers: number | null;
  following: number | null;
  tweetCount: number | null;
  verified: boolean;
  accountAgeDays: number | null;
  // Averaged over the recent tweets sampled; null when tweets couldn't be read.
  avgEngagementPerTweet: number | null;
  sampledTweets: number;
}

async function xFetch<T>(path: string): Promise<T | null> {
  const token = bearer();
  if (!token) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return null; // 401/403/429/5xx — degrade to null
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Look up one profile's metrics + average engagement over recent tweets.
// Returns null when X is disabled/unavailable or the handle doesn't resolve.
export async function getXProfileMetrics(
  handleOrLink: string,
  tweetSample = 20,
): Promise<XProfileMetrics | null> {
  const handle = parseXHandle(handleOrLink);
  if (!handle) return null;

  const userRes = await xFetch<{ data?: RawUser }>(
    `/users/by/username/${handle}?user.fields=public_metrics,created_at,verified`,
  );
  const user = userRes?.data;
  if (!user?.id) return null;

  const pm = user.public_metrics ?? {};
  const followers = typeof pm.followers_count === "number" ? pm.followers_count : null;

  let accountAgeDays: number | null = null;
  if (user.created_at) {
    const created = Date.parse(user.created_at);
    if (!Number.isNaN(created)) {
      accountAgeDays = Math.max(0, (Date.now() - created) / 86_400_000);
    }
  }

  // Recent tweets for an engagement average. Best-effort — null if unavailable.
  let avgEngagement: number | null = null;
  let sampled = 0;
  const tweetsRes = await xFetch<{ data?: RawTweet[] }>(
    `/users/${user.id}/tweets?max_results=${Math.min(Math.max(tweetSample, 5), 100)}&tweet.fields=public_metrics`,
  );
  const tweets = tweetsRes?.data;
  if (Array.isArray(tweets) && tweets.length > 0) {
    let sum = 0;
    for (const t of tweets) {
      const m = t.public_metrics ?? {};
      sum +=
        (m.like_count ?? 0) +
        (m.retweet_count ?? 0) +
        (m.reply_count ?? 0) +
        (m.quote_count ?? 0);
    }
    sampled = tweets.length;
    avgEngagement = sum / tweets.length;
  }

  return {
    handle,
    followers,
    following: typeof pm.following_count === "number" ? pm.following_count : null,
    tweetCount: typeof pm.tweet_count === "number" ? pm.tweet_count : null,
    verified: user.verified === true,
    accountAgeDays: accountAgeDays === null ? null : Math.round(accountAgeDays * 10) / 10,
    avgEngagementPerTweet:
      avgEngagement === null ? null : Math.round(avgEngagement * 10) / 10,
    sampledTweets: sampled,
  };
}

// Turn X profile metrics into a 0-100 presence score. Signals only — this
// measures reach and engagement, NOT authenticity (bot followers can't be
// reliably detected from public metrics, so we don't claim to).
//   - Followers: 55 pts, saturating ~50k (early meme accounts rarely exceed this)
//   - Engagement per tweet: 30 pts, saturating ~200 (likes+RT+replies+quotes)
//   - Verified: 15 pts
// Very new accounts (< maxAgeDaysCaution) are capped at 50 — reach can be faked
// fast, account age can't. Matches gem-score.md's caution on brand-new socials.
export function computeXScore(m: XProfileMetrics, maxAgeDaysCaution = 14): number {
  let score = 0;

  if (m.followers != null && m.followers > 0) {
    score += Math.min(m.followers / 50_000, 1) * 55;
  }
  if (m.avgEngagementPerTweet != null && m.avgEngagementPerTweet > 0) {
    score += Math.min(m.avgEngagementPerTweet / 200, 1) * 30;
  }
  if (m.verified) score += 15;

  if (m.accountAgeDays != null && m.accountAgeDays < maxAgeDaysCaution) {
    score = Math.min(score, 50);
  }

  return Math.round(Math.min(Math.max(score, 0), 100) * 10) / 10;
}
