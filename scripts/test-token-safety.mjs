// Unit tests for the pre-entry token-safety gate (pure evaluateTokenSafety).
// No chain, no network — compiles the lib with tsc then exercises the pure
// verdict logic with synthetic on-chain metrics and an explicit config.
// Run: node scripts/test-token-safety.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = mkdtempSync(join(root, "node_modules", ".safety-test-"));

function addJsExtensions(dir) {
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".js")) continue;
    const p = join(dir, f);
    const src = readFileSync(p, "utf8");
    const fixed = src.replace(
      /(from\s+["']|import\(["'])(\.\.?\/[^"']+?)(["'])/g,
      (m, pre, spec, post) => (spec.endsWith(".js") ? m : `${pre}${spec}.js${post}`),
    );
    if (fixed !== src) writeFileSync(p, fixed, "utf8");
  }
}

try {
  execFileSync(
    join(root, "node_modules/.bin/tsc"),
    [
      "src/lib/token-safety.ts",
      "--outDir",
      outDir,
      "--module",
      "esnext",
      "--target",
      "es2022",
      "--moduleResolution",
      "bundler",
      "--skipLibCheck",
      "--esModuleInterop",
    ],
    { cwd: root, stdio: "inherit" },
  );
} catch (e) {
  console.error("tsc failed:", e.message);
  process.exit(1);
}

addJsExtensions(outDir);

const { evaluateTokenSafety } = await import(
  pathToFileURL(join(outDir, "token-safety.js")).href
);

let passed = 0;
let failed = 0;
const green = (m) => console.log(`  \x1b[32mPASS\x1b[0m ${m}`);
const red = (m) => {
  console.log(`  \x1b[31mFAIL\x1b[0m ${m}`);
  failed++;
};
const assert = (cond, msg) => (cond ? (passed++, green(msg)) : red(msg));

// Explicit config so the test never depends on env defaults.
const CFG = {
  minLiquidityUsd: 20_000,
  maxTopHolderShare: 0.3,
  maxTop10Share: 0.6,
  minTokenAgeSeconds: 300,
  minHolderCount: 50,
  maxRugRiskScore: 60,
};

// A clean, healthy token: renounced, deep liquidity, LP fully locked, well
// distributed, old enough, many holders, no insiders.
function cleanToken(overrides = {}) {
  return {
    mint: "MintClean",
    decimals: 9,
    supply: 1_000_000,
    holderConcentrationTop10: 0.2,
    largestHolderShare: 0.05,
    holderCount: 500,
    mintAuthorityRevoked: true,
    freezeAuthorityRevoked: true,
    ageSeconds: 86_400,
    liquidity: null,
    ...overrides,
    rugcheck: {
      scoreNormalised: 0,
      topRisks: [],
      lpLockedPct: 100,
      insiderNetworkCount: 0,
      totalMarketLiquidity: 100_000,
      ...overrides.rugcheck,
    },
  };
}

console.log("\n── Clean token ──");
{
  const v = evaluateTokenSafety(cleanToken(), CFG);
  assert(!v.rejected, "clean token accepted");
  assert(v.rugRisk < 20, `clean token low rug risk (${v.rugRisk})`);
}

console.log("\n── Hard rejects ──");
{
  const mint = evaluateTokenSafety(cleanToken({ mintAuthorityRevoked: false }), CFG);
  assert(mint.rejected, "mint authority not revoked => reject");

  const thin = evaluateTokenSafety(
    cleanToken({ rugcheck: { totalMarketLiquidity: 5_000 } }),
    CFG,
  );
  assert(thin.rejected, "liquidity below floor => reject");

  const noLiq = evaluateTokenSafety(
    cleanToken({ rugcheck: { totalMarketLiquidity: undefined } }),
    CFG,
  );
  assert(noLiq.rejected, "unknown liquidity fails closed => reject");

  const young = evaluateTokenSafety(cleanToken({ ageSeconds: 60 }), CFG);
  assert(young.rejected, "token younger than floor => reject");

  const whale = evaluateTokenSafety(cleanToken({ largestHolderShare: 0.5 }), CFG);
  assert(whale.rejected, "single holder > ceiling => reject");

  const top10 = evaluateTokenSafety(cleanToken({ holderConcentrationTop10: 0.7 }), CFG);
  assert(top10.rejected, "top-10 > ceiling => reject");
}

console.log("\n── Graded risk accumulation ──");
{
  // Freeze live + LP unlocked + unknown holders — none a hard reject alone, but
  // together they should cross the rug-risk threshold.
  const v = evaluateTokenSafety(
    cleanToken({
      freezeAuthorityRevoked: false,
      holderCount: null,
      rugcheck: { lpLockedPct: 10, insiderNetworkCount: 1, scoreNormalised: 40 },
    }),
    CFG,
  );
  assert(v.rejected, `stacked weak signals cross threshold (rugRisk ${v.rugRisk})`);
  assert(v.rugRisk >= CFG.maxRugRiskScore, "rug risk at/above threshold");
}

console.log("\n── Single weak signal does not reject ──");
{
  // Partial LP lock alone (+10) is well under the threshold.
  const v = evaluateTokenSafety(
    cleanToken({ rugcheck: { lpLockedPct: 70 } }),
    CFG,
  );
  assert(!v.rejected, "one weak signal => still accepted (conservative)");
  assert(v.rugRisk > 0 && v.rugRisk < CFG.maxRugRiskScore, `graded but under threshold (${v.rugRisk})`);
}

console.log("\n── Unknown age/LP are soft, not hard ──");
{
  const v = evaluateTokenSafety(
    cleanToken({ ageSeconds: null, rugcheck: { lpLockedPct: null } }),
    CFG,
  );
  assert(!v.rejected, "unknown age + unknown LP => accepted with risk, not rejected");
  assert(v.flags.some((f) => f.includes("age unknown")), "flags unknown age");
  assert(v.flags.some((f) => f.includes("LP lock unknown")), "flags unknown LP");
}

rmSync(outDir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
