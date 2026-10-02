// Live smoke test for src/lib/dexscreener.ts against the real DexScreener API.
// Compiles the single TS file and calls the live endpoint.
// Run: node scripts/test-dexscreener.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), "dex-"));

try {
  execFileSync(
    join(root, "node_modules/.bin/tsc"),
    [
      "src/lib/dexscreener.ts",
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

const { getDexScreenerData } = await import(
  pathToFileURL(join(outDir, "dexscreener.js")).href
);

let passed = 0;
let failed = 0;
const green = (m) => console.log(`  \x1b[32mPASS\x1b[0m ${m}`);
const red = (m) => {
  console.log(`  \x1b[31mFAIL\x1b[0m ${m}`);
  failed++;
};
const assert = (cond, msg) => (cond ? (passed++, green(msg)) : red(msg));

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const FAKE = "RugRugRugRugRugRugRugRugRugRugRugRugRugRugRug";

console.log("\nLive DexScreener (BONK, FAKE):");
const map = await getDexScreenerData([BONK, FAKE]);

const bonk = map.get(BONK);
assert(bonk != null, "BONK present");
assert(bonk && typeof bonk.volume24h === "number" && bonk.volume24h > 0, `BONK real 24h volume (${bonk?.volume24h})`);
assert(bonk && typeof bonk.buys24h === "number" && bonk.buys24h > 0, "BONK buy count present");
assert(bonk && typeof bonk.sells24h === "number", "BONK sell count present");
assert(bonk && typeof bonk.liquidityUsd === "number", "BONK liquidity present");
assert(!map.has(FAKE), "unknown mint omitted");

console.log("\nDedup + empty:");
assert((await getDexScreenerData([])).size === 0, "empty input => empty map");

rmSync(outDir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
