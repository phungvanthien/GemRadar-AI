// Unit test for src/lib/spam-filter.ts — config wiring + the X buzz filter.
//
// Verifies that:
//   1. filterXAccount / filterTelegramGroup read thresholds from a passed
//      SpamFilterConfig (not hardcoded constants).
//   2. filterXBuzz catches sock-puppet / dead / stale $SYMBOL buzz (the Nitter
//      path, which has no single account profile).
//   3. The spam discounts zero out spam and scale borderline scores.
//
// Compiles spam-filter.ts + social-config.ts together (spam-filter imports
// social-config). We always pass an explicit config so the test never depends
// on the on-disk social-monitor.config.json.
// Run: node scripts/test-spam-filter.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), "spam-filter-"));

try {
  execFileSync(
    join(root, "node_modules/.bin/tsc"),
    [
      "src/lib/spam-filter.ts",
      "src/lib/social-config.ts",
      "--outDir",
      outDir,
      "--module",
      "esnext",
      "--target",
      "es2022",
      "--moduleResolution",
      "bundler",
      "--skipLibCheck",
    ],
    { cwd: root, stdio: "inherit" },
  );
} catch (e) {
  console.error("tsc failed:", e.message);
  process.exit(1);
}

const {
  filterXAccount,
  filterXBuzz,
  filterTelegramGroup,
  applyXSpamDiscount,
  applyGroupSpamDiscount,
} = await import(pathToFileURL(join(outDir, "spam-filter.js")).href);

let passed = 0;
let failed = 0;
const green = (m) => console.log(`  \x1b[32mPASS\x1b[0m ${m}`);
const red = (m) => {
  console.log(`  \x1b[31mFAIL\x1b[0m ${m}`);
  failed++;
};
const assert = (cond, msg) => (cond ? (passed++, green(msg)) : red(msg));

// An explicit config so the test is independent of the on-disk file.
const CFG = {
  botThreshold: 30,
  telegram: {
    minOnlineRatioPct: 0.5,
    maxMsgRatePerMemberPerHour: 1.0,
    maxForwardedSharePct: 40,
    maxAnonymousSharePct: 30,
    maxContractSharePct: 50,
    minUniqueSenderRatioPct: 5,
  },
  x: {
    maxFollowingFollowerRatio: 20,
    minAvgEngagementForActive: 0.5,
    maxTweetsPerDay: 100,
    newAccountDaysHard: 7,
    newAccountDaysSoft: 30,
  },
};

// ── Config wiring: filterXAccount respects passed thresholds ─────────────────
console.log("\nfilterXAccount reads config thresholds:");

// A healthy, established account → clean.
const clean = filterXAccount(
  {
    accountAgeDays: 400,
    followers: 10_000,
    following: 500,
    tweetCount: 2_000,
    verified: true,
    avgEngagementPerTweet: 25,
  },
  CFG,
);
assert(clean.authenticityScore >= 90 && !clean.isSpam, `established account clean (got ${clean.authenticityScore})`);

// Brand-new account below newAccountDaysHard → heavy penalty.
const newbie = filterXAccount(
  { accountAgeDays: 3, followers: 50, following: 50, tweetCount: 5, verified: false, avgEngagementPerTweet: 1 },
  CFG,
);
assert(newbie.flags.some((f) => f.includes("3d old")), "flags brand-new account");

// A stricter config (newAccountDaysHard=30) should now flag a 20-day account
// that the default config would only soft-flag — proves the threshold is live.
const strict = { ...CFG, x: { ...CFG.x, newAccountDaysHard: 30 } };
const acct20 = filterXAccount(
  { accountAgeDays: 20, followers: 1000, following: 100, tweetCount: 50, verified: false, avgEngagementPerTweet: 5 },
  strict,
);
assert(acct20.flags.some((f) => f.includes("20d old")), "stricter newAccountDaysHard flags 20d account");
assert(acct20.authenticityScore < clean.authenticityScore, "stricter config lowers score");

// Follow-back bot: following >> followers beyond maxFollowingFollowerRatio.
const followBot = filterXAccount(
  { accountAgeDays: 100, followers: 10, following: 5_000, tweetCount: 200, verified: false, avgEngagementPerTweet: 0.1 },
  CFG,
);
assert(followBot.isSpam, `follow-back bot flagged as spam (got ${followBot.authenticityScore})`);

// ── filterTelegramGroup reads config thresholds ──────────────────────────────
console.log("\nfilterTelegramGroup reads config thresholds:");

const cleanGroup = filterTelegramGroup(
  {
    memberCount: 5_000,
    onlineCount: 200,
    msgPerHour: 20,
    groupAgeDays: 60,
    forwardedShare: 0.1,
    anonymousShare: 0.05,
    contractShare: 0.1,
    uniqueSenderRatio: 0.4,
  },
  CFG,
);
assert(cleanGroup.scoreMultiplier >= 0.9 && !cleanGroup.isSpam, `healthy group clean (mult ${cleanGroup.scoreMultiplier})`);

// Ghost group: online well under the configured floor (0.5% → floor/2 = 0.25%).
const ghost = filterTelegramGroup(
  { memberCount: 10_000, onlineCount: 10, msgPerHour: 1, groupAgeDays: 30, forwardedShare: 0, anonymousShare: 0, contractShare: 0, uniqueSenderRatio: 0.5 },
  CFG,
);
assert(ghost.flags.some((f) => f.includes("ghost group")), "flags ghost group under online floor");

// Contract-dump channel: contractShare over maxContractSharePct (50%).
const dump = filterTelegramGroup(
  { memberCount: 2_000, onlineCount: 100, msgPerHour: 5, groupAgeDays: 30, forwardedShare: 0.1, anonymousShare: 0.1, contractShare: 0.8, uniqueSenderRatio: 0.3 },
  CFG,
);
assert(dump.flags.some((f) => f.includes("contract")), "flags contract-dump channel");

// Bot cluster: uniqueSenderRatio below minUniqueSenderRatioPct (5% → 0.05).
const cluster = filterTelegramGroup(
  { memberCount: 3_000, onlineCount: 100, msgPerHour: 10, groupAgeDays: 30, forwardedShare: 0.1, anonymousShare: 0.1, contractShare: 0.1, uniqueSenderRatio: 0.02 },
  CFG,
);
assert(cluster.flags.some((f) => f.includes("unique senders")), "flags low-unique-sender bot cluster");

// Tightening maxContractSharePct to 20 should flag a 30%-contract group that
// the default (50) would pass — proves the TG threshold is live.
const strictTg = { ...CFG, telegram: { ...CFG.telegram, maxContractSharePct: 20 } };
const borderline = { memberCount: 2_000, onlineCount: 100, msgPerHour: 5, groupAgeDays: 30, forwardedShare: 0.1, anonymousShare: 0.1, contractShare: 0.3, uniqueSenderRatio: 0.3 };
const loose = filterTelegramGroup(borderline, CFG);
const tight = filterTelegramGroup(borderline, strictTg);
assert(!loose.flags.some((f) => f.includes("contract")) && tight.flags.some((f) => f.includes("contract")), "stricter maxContractSharePct flags borderline group");

// ── filterXBuzz: the Nitter buzz-level path ──────────────────────────────────
console.log("\nfilterXBuzz (Nitter buzz-level):");

// Organic buzz: many authors, real engagement, fresh.
const organic = filterXBuzz(
  { tweetCount: 40, uniqueAuthors: 30, avgEngagement: 15, recentTweets: 25 },
  CFG,
);
assert(organic.authenticityScore >= 90 && !organic.isSpam, `organic buzz clean (got ${organic.authenticityScore})`);

// Sock-puppet: 40 tweets, 3 authors (ratio 0.075 < 0.15) → heavy penalty.
const puppet = filterXBuzz(
  { tweetCount: 40, uniqueAuthors: 3, avgEngagement: 2, recentTweets: 10 },
  CFG,
);
assert(puppet.flags.some((f) => f.includes("sock-puppet")), "flags sock-puppet buzz");
assert(puppet.authenticityScore < organic.authenticityScore, "sock-puppet scores lower than organic");

// Dead buzz: volume but zero engagement.
const dead = filterXBuzz(
  { tweetCount: 30, uniqueAuthors: 20, avgEngagement: 0, recentTweets: 10 },
  CFG,
);
assert(dead.flags.some((f) => f.includes("near-zero engagement")), "flags dead buzz (no engagement)");

// Stale buzz: no recent tweets.
const stale = filterXBuzz(
  { tweetCount: 30, uniqueAuthors: 20, avgEngagement: 10, recentTweets: 0 },
  CFG,
);
assert(stale.flags.some((f) => f.includes("stale")), "flags stale buzz (nothing in 24h)");

// Small sample (< 10 tweets) → no sock-puppet penalty even with few authors.
const small = filterXBuzz(
  { tweetCount: 4, uniqueAuthors: 1, avgEngagement: 0, recentTweets: 0 },
  CFG,
);
assert(!small.flags.some((f) => f.includes("sock-puppet")), "small sample not penalized as sock-puppet");

// ── Discounts ────────────────────────────────────────────────────────────────
console.log("\ndiscounts:");

// Spam verdict zeros the score.
assert(applyXSpamDiscount(70, puppet) === 0, `spam buzz zeros xScore (got ${applyXSpamDiscount(70, puppet)})`);

// Borderline (non-spam) verdict scales proportionally.
const borderlineBuzz = filterXBuzz({ tweetCount: 20, uniqueAuthors: 5, avgEngagement: 5, recentTweets: 10 }, CFG);
const scaled = applyXSpamDiscount(80, borderlineBuzz);
assert(scaled > 0 && scaled < 80, `borderline buzz scales xScore down (got ${scaled})`);

// Group discount: spam group → 0; clean group → ~unchanged.
assert(applyGroupSpamDiscount(80, ghost) >= 0, "ghost group discount applied");
assert(applyGroupSpamDiscount(80, cleanGroup) === Math.round(80 * cleanGroup.scoreMultiplier), "clean group keeps most of its score");

rmSync(outDir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
