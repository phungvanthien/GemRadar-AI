// spam-filter.ts — Bot & spam content filter for X (Twitter) and Telegram.
//
// Detects low-quality / inauthentic signals before they inflate social scores.
// Every function is pure and synchronous so it can be called inline without
// extra async overhead. Returns a SpamVerdict with a 0-100 authenticity score
// and a list of flags that explain what was found.
//
// Design principles:
//  - Conservative: genuine content should never be wrongly suppressed.
//  - Layered: multiple weak signals combine into a verdict, no single signal
//    hard-blocks. This avoids false positives on new-but-legitimate accounts.
//  - Transparent: every deduction is recorded in `flags` for the UI + AI.
//  - Configurable: thresholds come from social-monitor.config.json via
//    social-config.ts. Each public function takes an optional config override so
//    it stays pure/testable; omitting it loads the on-disk config (server-side).

import {
  getSocialMonitorConfig,
  type SpamFilterConfig,
  type SpamFilterTelegramConfig,
  type SpamFilterXConfig,
} from "./social-config";

// ─────────────────────────────────────────────────────────────────────────────
// Shared types
// ─────────────────────────────────────────────────────────────────────────────

export interface SpamVerdict {
  /** 0 = definitely spam/bot, 100 = clean signal. Used to discount social scores. */
  authenticityScore: number;
  /** True when the verdict is confident enough to filter out entirely (score < botThreshold). */
  isSpam: boolean;
  /** Human-readable flags explaining each deduction. Shown in the UI / AI context. */
  flags: string[];
}

// Resolve the spam-filter config: use the caller's override, else load it from
// social-monitor.config.json. Loading is cached in social-config.ts, so this is
// cheap to call per message/account.
function resolveConfig(override?: SpamFilterConfig): SpamFilterConfig {
  return override ?? getSocialMonitorConfig().spamFilter;
}

// ─────────────────────────────────────────────────────────────────────────────
// Text-level spam patterns (shared by X + Telegram)
// ─────────────────────────────────────────────────────────────────────────────

// Common patterns in bot-generated crypto spam.
const SPAM_PATTERNS: Array<{ re: RegExp; label: string; penalty: number }> = [
  // Airdrop / giveaway bait
  { re: /\b(free\s*airdrop|airdrop\s*claim|claim\s*(your|free)\s*(token|airdrop))\b/i, label: "airdrop bait", penalty: 20 },
  // Unrealistic return promises
  { re: /\b(1000x|10000x|moon(ing)?|to\s+the\s+moon|guaranteed\s+(profit|return|gain))\b/i, label: "pump promise", penalty: 15 },
  // Call-to-action urgency spam
  { re: /\b(buy\s+now|last\s+chance|don.t\s+miss|limited\s+time|act\s+fast|hurry)\b/i, label: "urgency CTA", penalty: 12 },
  // Shilling with coordinated tags
  { re: /(#[A-Za-z]+\s*){6,}/i, label: "hashtag flood", penalty: 18 },
  // Excessive mentions (bot coordination)
  { re: /(@\w+\s*){5,}/i, label: "mention flood", penalty: 18 },
  // Repeated emoji blasts (≥5 of the same emoji)
  { re: /(.)\1{4,}/u, label: "emoji/char flood", penalty: 10 },
  // Contract address spam (address posted without any context)
  { re: /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b.*\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/, label: "address dump", penalty: 15 },
  // Referral / invite links
  { re: /\b(ref(erral)?|invite)\s*code\b/i, label: "referral spam", penalty: 12 },
  // Copy-paste bot signatures
  { re: /\b(alpha\s+call|call\s+by\s+@|brought\s+to\s+you\s+by|powered\s+by\s+bot)\b/i, label: "bot signature", penalty: 20 },
  // Phishing / suspicious domains
  { re: /https?:\/\/[^\s]*\.(xyz|top|click|tk|ml|ga|gq|cf|ru)\b/i, label: "suspicious link", penalty: 20 },
];

// High-confidence bot indicators that each apply a heavier flat penalty.
const HARD_SPAM_PATTERNS: Array<{ re: RegExp; label: string; penalty: number }> = [
  // Wallet drainer signatures
  { re: /\b(connect\s+(your\s+)?wallet|approve\s+transaction|sign\s+to\s+(claim|verify))\b/i, label: "wallet drainer", penalty: 40 },
  // Impersonation of major projects
  { re: /\b(official\s+solana|official\s+raydium|official\s+jupiter)\b/i, label: "project impersonation", penalty: 35 },
  // Telegram group invite flood (t.me links in bulk)
  { re: /(t\.me\/[^\s]+\s*){3,}/i, label: "tg invite flood", penalty: 30 },
];

/**
 * Analyse raw message text for spam signals.
 * Returns penalty points (0 = clean, higher = spammier).
 */
function scoreText(text: string): { penalty: number; flags: string[] } {
  const flags: string[] = [];
  let penalty = 0;

  for (const { re, label, penalty: p } of HARD_SPAM_PATTERNS) {
    if (re.test(text)) {
      flags.push(label);
      penalty += p;
    }
  }

  for (const { re, label, penalty: p } of SPAM_PATTERNS) {
    if (re.test(text)) {
      flags.push(label);
      penalty += p;
    }
  }

  // All-caps ratio (shouting = spam signal)
  const letters = text.replace(/[^a-z]/gi, "");
  if (letters.length > 20) {
    const capsRatio = (text.replace(/[^A-Z]/g, "").length / letters.length);
    if (capsRatio > 0.7) {
      flags.push(`all-caps ${Math.round(capsRatio * 100)}%`);
      penalty += 12;
    }
  }

  // Very short but contains a contract address (contract dump with no context)
  const words = text.trim().split(/\s+/).length;
  if (words < 5 && /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/.test(text)) {
    flags.push("bare contract dump");
    penalty += 15;
  }

  return { penalty, flags };
}

// ─────────────────────────────────────────────────────────────────────────────
// X (Twitter) account-level bot detection
// ─────────────────────────────────────────────────────────────────────────────

export interface XAccountSignals {
  /** Account age in days. */
  accountAgeDays: number | null;
  /** Follower count. */
  followers: number | null;
  /** Following count. */
  following: number | null;
  /** Total tweet count since account creation. */
  tweetCount: number | null;
  /** Whether the account has a verified badge. */
  verified: boolean;
  /** Average engagement per tweet (likes + RT + replies + quotes). */
  avgEngagementPerTweet: number | null;
  /** Display name of the account (for pattern matching). */
  displayName?: string;
  /** Bio text (for pattern matching). */
  bio?: string;
}

/**
 * Evaluate an X account for bot/inauthentic behaviour.
 * Returns a SpamVerdict (authenticityScore 0-100, isSpam, flags).
 *
 * Signal model (total 100 pts deducted from 100):
 *  - Account age < 7d         → -30 (very new accounts can't be trusted)
 *  - Account age 7-30d        → -15
 *  - Following/Follower ratio > 20 → -20 (classic follow-back bot pattern)
 *  - Zero engagement on 10+ tweets → -25 (ghost / bot account)
 *  - Engagement/followers ratio extremely high → -15 (inflated/fake engagement)
 *  - Suspicious name patterns → -15
 *  - Bio spam signals         → up to -20
 *  - Tweet frequency > 100/day → -15 (bot posting rate)
 */
export function filterXAccount(
  signals: XAccountSignals,
  config?: SpamFilterConfig,
): SpamVerdict {
  const cfg = resolveConfig(config);
  const x: SpamFilterXConfig = cfg.x;
  const flags: string[] = [];
  let penalty = 0;

  // 1. Account age
  if (signals.accountAgeDays !== null) {
    if (signals.accountAgeDays < x.newAccountDaysHard) {
      flags.push(`account only ${Math.round(signals.accountAgeDays)}d old`);
      penalty += 30;
    } else if (signals.accountAgeDays < x.newAccountDaysSoft) {
      flags.push(`account ${Math.round(signals.accountAgeDays)}d old`);
      penalty += 15;
    }
  }

  // 2. Follow-back bot pattern: following >> followers
  if (signals.followers !== null && signals.following !== null) {
    const ffRatio = signals.followers > 0
      ? signals.following / signals.followers
      : signals.following > 0 ? Infinity : 0;
    if (ffRatio > x.maxFollowingFollowerRatio) {
      flags.push(`following/follower ratio ${ffRatio.toFixed(1)}x`);
      penalty += 20;
    } else if (ffRatio > x.maxFollowingFollowerRatio / 4) {
      flags.push(`high follow ratio ${ffRatio.toFixed(1)}x`);
      penalty += 10;
    }
  }

  // 3. Engagement signals
  if (signals.avgEngagementPerTweet !== null) {
    if (signals.avgEngagementPerTweet < x.minAvgEngagementForActive && (signals.tweetCount ?? 0) >= 10) {
      flags.push("near-zero engagement (ghost/bot)");
      penalty += 25;
    }
    // Suspiciously high engagement relative to followers (bought engagement)
    if (signals.followers !== null && signals.followers > 100) {
      const engRate = signals.avgEngagementPerTweet / signals.followers;
      if (engRate > 0.5) {
        flags.push(`inflated engagement rate ${(engRate * 100).toFixed(0)}%`);
        penalty += 15;
      }
    }
  }

  // 4. Tweet frequency (tweets per day since account creation)
  if (signals.tweetCount !== null && signals.accountAgeDays !== null && signals.accountAgeDays > 0) {
    const tweetsPerDay = signals.tweetCount / signals.accountAgeDays;
    if (tweetsPerDay > x.maxTweetsPerDay) {
      flags.push(`${Math.round(tweetsPerDay)} tweets/day (bot rate)`);
      penalty += 15;
    } else if (tweetsPerDay > x.maxTweetsPerDay / 2) {
      flags.push(`${Math.round(tweetsPerDay)} tweets/day (high)`);
      penalty += 7;
    }
  }

  // 5. Suspicious display name patterns
  if (signals.displayName) {
    const { penalty: namePenalty, flags: nameFlags } = scoreText(signals.displayName);
    if (namePenalty > 0) {
      flags.push(...nameFlags.map((f) => `name: ${f}`));
      penalty += Math.min(namePenalty, 15); // cap name contribution
    }
    // Random character name (e.g. "xK7dN3mP" — bot pattern)
    if (/^[A-Za-z0-9]{8,16}$/.test(signals.displayName.replace(/\s/g, "")) &&
        !/[aeiouAEIOU]{2}/.test(signals.displayName)) {
      flags.push("random-char display name");
      penalty += 10;
    }
  }

  // 6. Bio spam signals
  if (signals.bio) {
    const { penalty: bioPenalty, flags: bioFlags } = scoreText(signals.bio);
    if (bioPenalty > 0) {
      flags.push(...bioFlags.map((f) => `bio: ${f}`));
      penalty += Math.min(bioPenalty, 20);
    }
  }

  // Verified accounts get a mild authenticity bonus.
  if (signals.verified) {
    penalty = Math.max(0, penalty - 10);
    flags.push("verified");
  }

  const authenticityScore = Math.max(0, Math.min(100, 100 - penalty));
  return {
    authenticityScore,
    isSpam: authenticityScore < cfg.botThreshold,
    flags,
  };
}

/**
 * Filter a single tweet's text for spam content.
 * Returns a SpamVerdict for the content (not the account).
 * Combine with filterXAccount for a full picture.
 */
export function filterXTweet(text: string, config?: SpamFilterConfig): SpamVerdict {
  const cfg = resolveConfig(config);
  const { penalty, flags } = scoreText(text);
  const authenticityScore = Math.max(0, Math.min(100, 100 - penalty));
  return {
    authenticityScore,
    isSpam: authenticityScore < cfg.botThreshold,
    flags,
  };
}

/**
 * Combined X signal filter: evaluates both account signals and tweet text,
 * returning the worse of the two (conservative — either the account OR the
 * content being spammy is enough to suppress it).
 */
export function filterXSignal(
  account: XAccountSignals,
  tweetText?: string,
  config?: SpamFilterConfig,
): SpamVerdict {
  const cfg = resolveConfig(config);
  const accountVerdict = filterXAccount(account, cfg);
  if (!tweetText) return accountVerdict;

  const tweetVerdict = filterXTweet(tweetText, cfg);
  // Take the lower (worse) authenticity score.
  if (tweetVerdict.authenticityScore < accountVerdict.authenticityScore) {
    return {
      authenticityScore: tweetVerdict.authenticityScore,
      isSpam: tweetVerdict.isSpam,
      flags: [...accountVerdict.flags, ...tweetVerdict.flags.map((f) => `tweet: ${f}`)],
    };
  }
  return {
    ...accountVerdict,
    flags: [...accountVerdict.flags, ...(tweetVerdict.flags.length > 0 ? tweetVerdict.flags.map((f) => `tweet: ${f}`) : [])],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// X (Twitter) buzz-level bot detection — for the Nitter RSS path
// ─────────────────────────────────────────────────────────────────────────────

export interface XBuzzSignals {
  /** Tweets seen in the $SYMBOL search sample. */
  tweetCount: number;
  /** Distinct authors across those tweets. */
  uniqueAuthors: number;
  /** Average engagement (likes + retweets) per tweet in the sample. */
  avgEngagement: number;
  /** Tweets within the recency window (< 24h). */
  recentTweets: number;
}

/**
 * Evaluate $SYMBOL buzz from a Nitter RSS search for bot-inflation.
 *
 * The Nitter search path produces AGGREGATE buzz across many authors, not a
 * single profile, so filterXAccount (which needs account age / follower ratios)
 * doesn't apply. This checks the signals we actually have:
 *   - Sock-puppet ratio: many tweets from very few authors → coordinated shill.
 *   - Dead buzz: non-trivial tweet volume with zero engagement → bot farm.
 *   - Stale buzz: no recent tweets in a large sample → recycled/old chatter.
 *
 * Returns a SpamVerdict whose authenticityScore discounts the raw xScore the
 * same way filterXAccount does for the official-API path.
 */
export function filterXBuzz(
  buzz: XBuzzSignals,
  config?: SpamFilterConfig,
): SpamVerdict {
  const cfg = resolveConfig(config);
  const flags: string[] = [];
  let penalty = 0;

  // 1. Sock-puppet ratio: with ≥10 tweets, few distinct authors is coordinated.
  //    Mirrors the worker's X_PUPPET_RATIO (0.30) cap but as a graded penalty.
  if (buzz.tweetCount >= 10 && buzz.uniqueAuthors > 0) {
    const authorRatio = buzz.uniqueAuthors / buzz.tweetCount;
    if (authorRatio < 0.15) {
      flags.push(`sock-puppet: ${buzz.uniqueAuthors}/${buzz.tweetCount} authors`);
      penalty += 40;
    } else if (authorRatio < 0.3) {
      flags.push(`low author diversity: ${buzz.uniqueAuthors}/${buzz.tweetCount}`);
      penalty += 20;
    }
  }

  // 2. Dead buzz: real tweet volume but ~zero engagement → bot/zombie activity.
  if (buzz.tweetCount >= 10 && buzz.avgEngagement < cfg.x.minAvgEngagementForActive) {
    flags.push("near-zero engagement (bot buzz)");
    penalty += 25;
  }

  // 3. Stale buzz: a non-trivial sample with no fresh tweets → recycled chatter.
  if (buzz.tweetCount >= 10 && buzz.recentTweets === 0) {
    flags.push("no tweets in last 24h (stale)");
    penalty += 15;
  }

  const authenticityScore = Math.max(0, Math.min(100, 100 - penalty));
  return {
    authenticityScore,
    isSpam: authenticityScore < cfg.botThreshold,
    flags,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Telegram message + group-level spam detection
// ─────────────────────────────────────────────────────────────────────────────

export interface TelegramMessageSignals {
  /** Raw message text. */
  text: string;
  /** Whether the sender is anonymous/hidden. */
  isAnonymous?: boolean;
  /** Whether the sender has a Telegram username (no username = harder to verify). */
  hasUsername?: boolean;
  /** Sender's account age in days (if available from the Telegram API). */
  senderAgeDays?: number | null;
  /** Whether this is a forwarded message (often spam amplification). */
  isForwarded?: boolean;
  /** Number of times this exact message has been seen in the last N messages (dedup window). */
  duplicateCount?: number;
}

export interface TelegramGroupSignals {
  /** Total member count. */
  memberCount: number | null;
  /** Online members (if available). */
  onlineCount?: number | null;
  /** Average messages per hour over a recent window. */
  msgPerHour: number | null;
  /** Group age in days. */
  groupAgeDays: number | null;
  /** Share of messages (0-1) in the last sample that were forwarded. */
  forwardedShare?: number | null;
  /** Share of messages (0-1) from anonymous senders. */
  anonymousShare?: number | null;
  /** Share of messages (0-1) containing contract addresses. */
  contractShare?: number | null;
  /** Ratio of unique senders to total messages (low = concentrated bot activity). */
  uniqueSenderRatio?: number | null;
}

/**
 * Evaluate a single Telegram message for spam/bot signals.
 */
export function filterTelegramMessage(
  msg: TelegramMessageSignals,
  config?: SpamFilterConfig,
): SpamVerdict {
  const cfg = resolveConfig(config);
  const flags: string[] = [];
  let penalty = 0;

  // 1. Text-level spam patterns
  const { penalty: textPenalty, flags: textFlags } = scoreText(msg.text);
  penalty += textPenalty;
  flags.push(...textFlags);

  // 2. Anonymous sender (legitimate admins rarely post anonymously for engagement)
  if (msg.isAnonymous) {
    flags.push("anonymous sender");
    penalty += 10;
  }

  // 3. No username (throwaway / fresh bot account)
  if (msg.hasUsername === false) {
    flags.push("no username");
    penalty += 8;
  }

  // 4. Very new sender account
  if (typeof msg.senderAgeDays === "number" && msg.senderAgeDays < 7) {
    flags.push(`sender account ${Math.round(msg.senderAgeDays)}d old`);
    penalty += 20;
  }

  // 5. Forwarded message (often used to amplify spam across groups)
  if (msg.isForwarded) {
    flags.push("forwarded");
    penalty += 8;
  }

  // 6. Duplicate / repeated message in this group
  if (typeof msg.duplicateCount === "number" && msg.duplicateCount > 1) {
    const extra = Math.min((msg.duplicateCount - 1) * 8, 24);
    flags.push(`duplicate ×${msg.duplicateCount}`);
    penalty += extra;
  }

  const authenticityScore = Math.max(0, Math.min(100, 100 - penalty));
  return {
    authenticityScore,
    isSpam: authenticityScore < cfg.botThreshold,
    flags,
  };
}

/**
 * Evaluate a Telegram group's aggregate activity for bot inflation signals.
 * Used to discount the socialScore of groups that look artificially inflated.
 *
 * Returns a multiplier (0-1) to apply to the raw socialScore:
 *   1.0 = clean group, no discount
 *   0.0 = group looks entirely bot-inflated, socialScore zeroed out
 *
 * Also returns a SpamVerdict for logging/UI.
 *
 * Config note: the telegram.* share thresholds are stored as PERCENTAGES
 * (e.g. maxForwardedSharePct: 40) while the signals are 0-1 ratios, so each is
 * divided by 100 before comparing. minOnlineRatioPct is also a percent.
 */
export function filterTelegramGroup(
  group: TelegramGroupSignals,
  config?: SpamFilterConfig,
): SpamVerdict & { scoreMultiplier: number } {
  const cfg = resolveConfig(config);
  const tg: SpamFilterTelegramConfig = cfg.telegram;
  const flags: string[] = [];
  let penalty = 0;

  // 1. Member/online ratio: if online is far below the configured floor, the
  //    group is ghost/bought. minOnlineRatioPct is a percent (e.g. 0.5 = 0.5%).
  if (group.memberCount !== null && group.onlineCount != null && group.memberCount > 500) {
    const onlineRatio = group.onlineCount / group.memberCount;
    const floor = tg.minOnlineRatioPct / 100;
    if (onlineRatio < floor / 2) {
      flags.push(`ghost group: ${(onlineRatio * 100).toFixed(2)}% online`);
      penalty += 25;
    } else if (onlineRatio < floor) {
      flags.push(`low engagement: ${(onlineRatio * 100).toFixed(2)}% online`);
      penalty += 12;
    }
  }

  // 2. Message rate vs members: suspicious spikes
  if (group.msgPerHour !== null && group.memberCount !== null && group.memberCount > 0) {
    const msgRate = group.msgPerHour / group.memberCount;
    if (msgRate > tg.maxMsgRatePerMemberPerHour) {
      // More than the configured msg/hour/member → likely bot posting
      flags.push(`high msg rate ${msgRate.toFixed(2)} msg/hr/member`);
      penalty += 20;
    }
  }

  // 3. Very new group
  if (group.groupAgeDays !== null && group.groupAgeDays < 3) {
    flags.push(`group only ${Math.round(group.groupAgeDays)}d old`);
    penalty += 20;
  } else if (group.groupAgeDays !== null && group.groupAgeDays < 7) {
    flags.push(`group ${Math.round(group.groupAgeDays)}d old`);
    penalty += 10;
  }

  // 4. High forwarded message share
  if (typeof group.forwardedShare === "number" && group.forwardedShare > tg.maxForwardedSharePct / 100) {
    flags.push(`${Math.round(group.forwardedShare * 100)}% forwarded msgs`);
    penalty += 15;
  }

  // 5. High anonymous sender share
  if (typeof group.anonymousShare === "number" && group.anonymousShare > tg.maxAnonymousSharePct / 100) {
    flags.push(`${Math.round(group.anonymousShare * 100)}% anonymous msgs`);
    penalty += 12;
  }

  // 6. High contract address share (contract dump channels)
  if (typeof group.contractShare === "number" && group.contractShare > tg.maxContractSharePct / 100) {
    flags.push(`${Math.round(group.contractShare * 100)}% msgs with contract`);
    penalty += 18;
  }

  // 7. Low unique sender ratio (few senders sending many messages → bot cluster).
  //    minUniqueSenderRatioPct is a percent (e.g. 5 = 5%).
  const uniqueFloor = tg.minUniqueSenderRatioPct / 100;
  if (typeof group.uniqueSenderRatio === "number" && group.uniqueSenderRatio < uniqueFloor) {
    flags.push(`low unique senders ${(group.uniqueSenderRatio * 100).toFixed(1)}%`);
    penalty += 20;
  } else if (typeof group.uniqueSenderRatio === "number" && group.uniqueSenderRatio < uniqueFloor * 3) {
    flags.push(`concentrated senders ${(group.uniqueSenderRatio * 100).toFixed(1)}%`);
    penalty += 10;
  }

  const authenticityScore = Math.max(0, Math.min(100, 100 - penalty));
  // scoreMultiplier: linear from 1 (clean) to 0 (all spam)
  const scoreMultiplier = Number((authenticityScore / 100).toFixed(2));

  return {
    authenticityScore,
    isSpam: authenticityScore < cfg.botThreshold,
    flags,
    scoreMultiplier,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk message deduplication (for Telegram history samples)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalise a message text for deduplication: lower-case, strip punctuation
 * and extra whitespace. Contract addresses and t.me links are kept as-is
 * because they're meaningful signals.
 */
function normaliseForDedup(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s.:/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Given a list of raw message texts from a Telegram history sample, return a
 * Map<normalised_text, count> so callers can identify repeated/bot-spammed messages
 * and pass `duplicateCount` to filterTelegramMessage.
 */
export function buildDedupMap(messages: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const msg of messages) {
    const key = normaliseForDedup(msg);
    if (key.length < 5) continue; // ignore empty / trivially short messages
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Compute aggregate group signals from a raw message sample.
 * The caller passes the raw text array; this function tallies the signals
 * that filterTelegramGroup needs.
 *
 * @param texts         Raw message texts in the sample window.
 * @param senders       Sender IDs/usernames per message (parallel array).
 * @param forwarded     Whether each message was forwarded (parallel array).
 * @param anonymous     Whether each sender is anonymous (parallel array).
 */
export function computeGroupSignals(
  texts: string[],
  senders: (string | null)[],
  forwarded: boolean[],
  anonymous: boolean[],
): Pick<TelegramGroupSignals, "forwardedShare" | "anonymousShare" | "contractShare" | "uniqueSenderRatio"> {
  const n = texts.length;
  if (n === 0) {
    return { forwardedShare: null, anonymousShare: null, contractShare: null, uniqueSenderRatio: null };
  }

  const CONTRACT_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/;
  let fwdCount = 0;
  let anonCount = 0;
  let contractCount = 0;
  const uniqueSenders = new Set<string>();

  for (let i = 0; i < n; i++) {
    if (forwarded[i]) fwdCount++;
    if (anonymous[i]) anonCount++;
    if (CONTRACT_RE.test(texts[i] ?? "")) contractCount++;
    const sender = senders[i];
    if (sender) uniqueSenders.add(sender);
  }

  return {
    forwardedShare: Number((fwdCount / n).toFixed(2)),
    anonymousShare: Number((anonCount / n).toFixed(2)),
    contractShare: Number((contractCount / n).toFixed(2)),
    uniqueSenderRatio: n > 0 ? Number((uniqueSenders.size / n).toFixed(2)) : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Apply spam filter to social scores (integration helper)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Discount a raw socialScore (0-100) from the Telegram worker by the group's
 * spam multiplier. Call this before passing SocialSignals to gem-score.ts.
 *
 * Example:
 *   rawScore = 80, multiplier = 0.4 → adjusted = 32
 */
export function applyGroupSpamDiscount(
  rawSocialScore: number,
  groupVerdict: ReturnType<typeof filterTelegramGroup>,
): number {
  if (groupVerdict.isSpam) return 0;
  return Math.round(rawSocialScore * groupVerdict.scoreMultiplier);
}

/**
 * Discount a raw xScore (0-100) by the account's authenticity score.
 * Spam accounts get their score set to 0; borderline accounts are discounted
 * proportionally.
 *
 * Example:
 *   rawXScore = 70, authenticityScore = 60 → adjusted = 42
 */
export function applyXSpamDiscount(
  rawXScore: number,
  verdict: SpamVerdict,
): number {
  if (verdict.isSpam) return 0;
  return Math.round(rawXScore * (verdict.authenticityScore / 100));
}
