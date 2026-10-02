// Live smoke test for src/lib/jupiter.ts against the real Jupiter v3 endpoint.
// Compiles the single TS file (no imports needing resolution beyond a type-only
// import of ./gem-score, which tsc erases) and calls the live API.
// Run: node scripts/test-jupiter.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), "jupiter-"));

try {
  execFileSync(
    join(root, "node_modules/.bin/tsc"),
    [
      "src/lib/jupiter.ts",
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

const { getJupiterPrices } = await import(
  pathToFileURL(join(outDir, "jupiter.js")).href
);

let passed = 0;
let failed = 0;
const green = (m) => console.log(`  \x1b[32mPASS\x1b[0m ${m}`);
const red = (m) => {
  console.log(`  \x1b[31mFAIL\x1b[0m ${m}`);
  failed++;
};
const assert = (cond, msg) => (cond ? (passed++, green(msg)) : red(msg));

const SOL = "So11111111111111111111111111111111111111112";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const FAKE = "RugRugRugRugRugRugRugRugRugRugRugRugRugRugRug";

console.log("\nLive Jupiter v3 batch (SOL, BONK, FAKE):");
const map = await getJupiterPrices([SOL, BONK, FAKE]);

const sol = map.get(SOL);
assert(sol != null, "SOL present in result");
assert(sol && typeof sol.usdPrice === "number" && sol.usdPrice > 0, `SOL usdPrice > 0 (${sol?.usdPrice})`);
assert(sol && typeof sol.liquidity === "number" && sol.liquidity > 0, "SOL liquidity present");
assert(sol && typeof sol.priceChange24h === "number", "SOL priceChange24h present");

const bonk = map.get(BONK);
assert(bonk != null, "BONK present in result");

assert(!map.has(FAKE), "unknown mint omitted (not an error)");

console.log("\nDedup + empty input:");
const empty = await getJupiterPrices([]);
assert(empty.size === 0, "empty input => empty map");
const deduped = await getJupiterPrices([SOL, SOL, SOL]);
assert(deduped.size === 1, "duplicate mints deduped");

rmSync(outDir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
