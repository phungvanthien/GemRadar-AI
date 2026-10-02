// Unit test for the pure logic in src/lib/x.ts: parseXHandle + computeXScore.
// Does NOT hit the X API (that needs a paid bearer token). Compiles the single
// file and tests the deterministic helpers.
// Run: node scripts/test-x.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), "x-"));

try {
  execFileSync(
    join(root, "node_modules/.bin/tsc"),
    ["src/lib/x.ts", "--outDir", outDir, "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler", "--skipLibCheck"],
    { cwd: root, stdio: "inherit" },
  );
} catch (e) {
  console.error("tsc failed:", e.message);
  process.exit(1);
}

const { parseXHandle, computeXScore } = await import(
  pathToFileURL(join(outDir, "x.js")).href
);

let passed = 0;
let failed = 0;
const green = (m) => console.log(`  \x1b[32mPASS\x1b[0m ${m}`);
const red = (m) => {
  console.log(`  \x1b[31mFAIL\x1b[0m ${m}`);
  failed++;
};
const assert = (cond, msg) => (cond ? (passed++, green(msg)) : red(msg));

console.log("\nparseXHandle:");
assert(parseXHandle("https://x.com/solana") === "solana", "https x.com");
assert(parseXHandle("https://twitter.com/solana") === "solana", "https twitter.com");
assert(parseXHandle("x.com/solana") === "solana", "bare x.com");
assert(parseXHandle("@solana") === "solana", "@handle");
assert(parseXHandle("solana") === "solana", "bare handle");
assert(parseXHandle("https://x.com/solana?s=20") === "solana", "strips query");
assert(parseXHandle("https://x.com/i/status/123") === null, "reserved /i/ rejected");
assert(parseXHandle("https://t.me/solana") === null, "telegram link rejected");
assert(parseXHandle("") === null, "empty rejected");
assert(parseXHandle("way_too_long_handle_here") === null, "over 15 chars rejected");

console.log("\ncomputeXScore:");
const big = computeXScore({
  handle: "x", followers: 50_000, following: 100, tweetCount: 500,
  verified: true, accountAgeDays: 365, avgEngagementPerTweet: 200, sampledTweets: 20,
});
assert(big === 100, `large verified account => 100 (got ${big})`);

const tiny = computeXScore({
  handle: "x", followers: 0, following: 0, tweetCount: 0,
  verified: false, accountAgeDays: 400, avgEngagementPerTweet: 0, sampledTweets: 0,
});
assert(tiny === 0, `empty account => 0 (got ${tiny})`);

const newAcct = computeXScore({
  handle: "x", followers: 50_000, following: 100, tweetCount: 500,
  verified: true, accountAgeDays: 3, avgEngagementPerTweet: 200, sampledTweets: 20,
}, 14);
assert(newAcct === 50, `brand-new account capped at 50 (got ${newAcct})`);

const midFollowers = computeXScore({
  handle: "x", followers: 25_000, following: 100, tweetCount: 100,
  verified: false, accountAgeDays: 100, avgEngagementPerTweet: null, sampledTweets: 0,
});
assert(midFollowers > 0 && midFollowers < 40, `mid followers, no engagement => partial (got ${midFollowers})`);

rmSync(outDir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
