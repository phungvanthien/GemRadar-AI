// Unit test for the gem-score model (src/lib/gem-score.ts).
//
// gem-score.ts is pure TypeScript with no runtime imports, so we compile just
// that one file to a temp dir with the project's own tsc, import the JS, and
// assert. No new dependency, no full build. Run: node scripts/test-gem-score.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), "gem-score-"));

// Compile the single file. --moduleResolution/target kept loose; the file has
// no imports that need resolving except the type-only import of ./types, which
// tsc erases (import type). We isolate it so ./types isn't needed at runtime.
try {
  execFileSync(
    join(root, "node_modules/.bin/tsc"),
    [
      "src/lib/gem-score.ts",
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

const { computeGemScore } = await import(
  pathToFileURL(join(outDir, "gem-score.js")).href
);

let passed = 0;
let failed = 0;
const green = (m) => console.log(`  \x1b[32mPASS\x1b[0m ${m}`);
const red = (m) => {
  console.log(`  \x1b[31mFAIL\x1b[0m ${m}`);
  failed++;
};
function assert(cond, msg) {
  if (cond) {
    passed++;
    green(msg);
  } else {
    red(msg);
  }
}

// --- Fixtures ---

// A clean, safe gem: authorities revoked, LP locked, low risk, well distributed,
// decent liquidity. No social data.
const safeToken = {
  onChain: {
    mint: "So11111111111111111111111111111111111111112",
    decimals: 9,
    supply: 1_000_000_000,
    holderConcentrationTop10: 0.12, // 12% — green
    largestHolderShare: 0.04, // 4% — green
    holderCount: 1200,
    mintAuthorityRevoked: true,
    freezeAuthorityRevoked: true,
    ageSeconds: 3600,
    liquidity: null,
    rugcheck: {
      scoreNormalised: 10, // low risk
      topRisks: [],
      lpLockedPct: 100,
      insiderNetworkCount: 0,
      totalMarketLiquidity: 60_000,
    },
  },
  jupiter: { usdPrice: 0.01, liquidity: 60_000, priceChange24h: 12 },
  // Real trading data: healthy volume, strong buy pressure.
  dex: {
    volume24h: 200_000,
    buys24h: 800,
    sells24h: 400,
    liquidityUsd: 60_000,
    marketCap: 50_000_000,
  },
};

// A dangerous token: authorities live, no LP lock, high risk, one whale holds
// most supply, few holders, thin liquidity.
const rugToken = {
  onChain: {
    mint: "RugRugRugRugRugRugRugRugRugRugRugRugRugRugRug",
    decimals: 6,
    supply: 1_000_000,
    holderConcentrationTop10: 0.85, // 85% — very concentrated
    largestHolderShare: 0.6, // 60% — one whale
    holderCount: 8,
    mintAuthorityRevoked: false,
    freezeAuthorityRevoked: false,
    ageSeconds: 120,
    liquidity: null,
    rugcheck: {
      scoreNormalised: 90, // high risk
      topRisks: ["Mint authority enabled", "Low liquidity"],
      lpLockedPct: 0,
      insiderNetworkCount: 4,
      totalMarketLiquidity: 400,
    },
  },
  jupiter: { usdPrice: 0.0001, liquidity: 400, priceChange24h: -40 },
  // Dumping: heavy sell pressure, thin volume.
  dex: {
    volume24h: 5_000,
    buys24h: 50,
    sells24h: 400,
    liquidityUsd: 400,
    marketCap: 100_000,
  },
};

// A token with no RugCheck data and no holder count — tests partial credit +
// coverage handling.
const sparseToken = {
  onChain: {
    mint: "SparseSparseSparseSparseSparseSparseSparse1",
    decimals: 9,
    supply: 500_000,
    holderConcentrationTop10: 0.3,
    largestHolderShare: 0.08,
    holderCount: null,
    mintAuthorityRevoked: true,
    freezeAuthorityRevoked: false,
    ageSeconds: null,
    liquidity: null,
    rugcheck: null,
  },
  // No jupiter => liquidity not covered.
};

// --- Tests ---

console.log("\nSafe token:");
const safe = computeGemScore(safeToken);
console.log("  breakdown:", JSON.stringify(safe, null, 2).replace(/\n/g, "\n  "));
assert(safe.security.covered && safe.security.score >= 85, "security high for safe token");
assert(safe.distribution.score >= 85, "distribution high for well-spread token");
assert(safe.liquidity.covered, "liquidity covered when data present");
assert(safe.liquidity.notes.some((n) => n.includes("vol24h")), "liquidity shows real 24h volume");
assert(safe.moneyFlow.covered && safe.moneyFlow.score >= 60, `money flow high for buy-heavy token (got ${safe.moneyFlow.score})`);
assert(safe.moneyFlow.notes.some((n) => n.includes("buys")), "money flow shows buy ratio");
assert(!safe.social.covered, "social not covered without worker data");
assert(safe.total >= 75, `total high for safe token (got ${safe.total})`);
assert(safe.coverage === 0.9, `coverage 0.9 without social (got ${safe.coverage})`);

console.log("\nRug token:");
const rug = computeGemScore(rugToken);
assert(rug.security.score <= 20, `security low for rug (got ${rug.security.score})`);
assert(rug.distribution.score <= 20, `distribution low for whale (got ${rug.distribution.score})`);
assert(rug.moneyFlow.score <= 40, `money flow low for dumping+insider token (got ${rug.moneyFlow.score})`);
assert(rug.total <= 30, `total low for rug token (got ${rug.total})`);
assert(rug.security.notes.some((n) => n.includes("LIVE")), "flags live authority");

console.log("\nSparse token (no RugCheck, no holder count, no Jupiter, no Dex):");
const sparse = computeGemScore(sparseToken);
assert(!sparse.liquidity.covered, "liquidity NOT covered without any liquidity data");
assert(!sparse.moneyFlow.covered, "money flow NOT covered without dex or insider data");
assert(sparse.coverage < 0.8, `coverage reduced when liquidity+moneyflow+social missing (got ${sparse.coverage})`);
assert(
  sparse.security.notes.includes("no RugCheck score"),
  "flags missing RugCheck score",
);
assert(
  sparse.distribution.notes.includes("holder count unknown"),
  "flags missing holder count",
);
assert(sparse.total > 0 && sparse.total <= 100, "total still valid with partial data");

console.log("\nSocial signals (Telegram + X combine):");
const withBoth = computeGemScore({ ...safeToken, social: { socialScore: 80, xScore: 60 } });
assert(withBoth.social.covered, "social covered with signals");
assert(withBoth.social.score === 70, `TG 80 + X 60 averaged => 70 (got ${withBoth.social.score})`);
assert(withBoth.social.notes.some((n) => n.includes("TG")) && withBoth.social.notes.some((n) => n.includes("X")), "notes show both TG and X");
assert(withBoth.coverage === 1, `full coverage with social present (got ${withBoth.coverage})`);

const xOnly = computeGemScore({ ...safeToken, social: { xScore: 40 } });
assert(xOnly.social.covered && xOnly.social.score === 40, `X-only social => 40 (got ${xOnly.social.score})`);

// Cleanup temp compile output.
rmSync(outDir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
