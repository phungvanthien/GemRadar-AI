// Tests the SINGLE live-funds gate (canTradeLive) and the wallet guards. The
// gate is the one function standing between dry-run and real money, so it gets
// explicit coverage: it must be false unless EVERY condition aligns.
// Run: node scripts/test-trade-config.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = mkdtempSync(join(root, "node_modules", ".trade-cfg-test-"));

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
      "src/lib/trade-config.ts",
      "src/lib/trade-wallet.ts",
      "--outDir",
      outDir,
      "--module", "esnext",
      "--target", "es2022",
      "--moduleResolution", "bundler",
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

const cfgMod = pathToFileURL(join(outDir, "trade-config.js")).href;
const walletMod = pathToFileURL(join(outDir, "trade-wallet.js")).href;

let passed = 0, failed = 0;
const green = (m) => console.log(`  \x1b[32mPASS\x1b[0m ${m}`);
const red = (m) => { console.log(`  \x1b[31mFAIL\x1b[0m ${m}`); failed++; };
const assert = (c, m) => (c ? (passed++, green(m)) : red(m));

// Reload the module with fresh env each time (resetTradeConfigCache clears the
// in-process cache; re-import gives a clean binding).
async function withEnv(env, fn) {
  const prev = {};
  for (const k of Object.keys(env)) { prev[k] = process.env[k]; if (env[k] == null) delete process.env[k]; else process.env[k] = env[k]; }
  const mod = await import(`${cfgMod}?t=${Math.random()}`);
  mod.resetTradeConfigCache();
  try { await fn(mod); } finally {
    mod.resetTradeConfigCache();
    for (const k of Object.keys(env)) { if (prev[k] == null) delete process.env[k]; else process.env[k] = prev[k]; }
  }
}

const DUMMY_KEY = "[1,2,3]"; // non-null; validity isn't checked by the gate

console.log("\n── canTradeLive gate ──");
await withEnv({ TRADE_MODE: "dry-run", TRADE_WALLET_SECRET_KEY: DUMMY_KEY, TRADE_KILL_SWITCH: "false" }, (m) => {
  assert(m.canTradeLive({ autoBuyEnabled: true }) === false, "dry-run mode => live blocked even with key + autoBuy");
});
await withEnv({ TRADE_MODE: "live", TRADE_WALLET_SECRET_KEY: DUMMY_KEY, TRADE_KILL_SWITCH: "false" }, (m) => {
  assert(m.canTradeLive({ autoBuyEnabled: false }) === false, "autoBuyEnabled=false => live blocked");
  assert(m.canTradeLive({ autoBuyEnabled: true }) === true, "live + key + autoBuy + kill off => LIVE allowed");
});
await withEnv({ TRADE_MODE: "live", TRADE_WALLET_SECRET_KEY: "", TRADE_KILL_SWITCH: "false" }, (m) => {
  assert(m.canTradeLive({ autoBuyEnabled: true }) === false, "no wallet key => live blocked");
});
await withEnv({ TRADE_MODE: "live", TRADE_WALLET_SECRET_KEY: DUMMY_KEY, TRADE_KILL_SWITCH: "true" }, (m) => {
  assert(m.canTradeLive({ autoBuyEnabled: true }) === false, "kill-switch on => live blocked");
});
await withEnv({ TRADE_MODE: "LIVE", TRADE_WALLET_SECRET_KEY: DUMMY_KEY, TRADE_KILL_SWITCH: "false" }, (m) => {
  assert(m.canTradeLive({ autoBuyEnabled: true }) === true, "TRADE_MODE case-insensitive (LIVE)");
});
// Default (no env) must be dry-run.
await withEnv({ TRADE_MODE: null, TRADE_WALLET_SECRET_KEY: null, TRADE_KILL_SWITCH: null }, (m) => {
  assert(m.getTradeConfig().mode === "dry-run", "unset TRADE_MODE defaults to dry-run");
  assert(m.canTradeLive({ autoBuyEnabled: true }) === false, "no config at all => live blocked");
});

console.log("\n── wallet guards ──");
const { assertUnderMaxSol, assertDailyCapOk, assertBalanceFloorOk, assertPoolDepthOk, assertPriceImpactOk, GuardError } = await import(walletMod);
const cfg = { maxSolPerTrade: 0.25, maxTradesPerDay: 3, minWalletSol: 0.05, slippageBps: 100, maxPriceImpactPct: 3, maxPoolShare: 0.02 };
const throws = (fn, code) => { try { fn(); return false; } catch (e) { return e instanceof GuardError && (!code || e.code === code); } };

assert(!throws(() => assertUnderMaxSol(0.1, cfg)), "0.1 SOL under cap => ok");
assert(throws(() => assertUnderMaxSol(0.5, cfg), "max-sol-per-trade"), "0.5 SOL over cap => blocked");
assert(throws(() => assertUnderMaxSol(0, cfg), "nonpositive-amount"), "0 SOL => blocked");
assert(!throws(() => assertDailyCapOk(2, cfg)), "2/3 trades => ok");
assert(throws(() => assertDailyCapOk(3, cfg), "daily-cap"), "3/3 trades => blocked");
assert(!throws(() => assertBalanceFloorOk(1, 0.1, cfg)), "balance leaves floor => ok");
assert(throws(() => assertBalanceFloorOk(0.1, 0.08, cfg), "balance-floor"), "buy drops below floor => blocked");
assert(throws(() => assertPoolDepthOk(100, null, cfg), "no-liquidity-data"), "null liquidity => blocked (fail closed)");
assert(throws(() => assertPoolDepthOk(100, 1000, cfg), "pool-too-thin"), "10% of pool => blocked");
assert(!throws(() => assertPoolDepthOk(10, 10000, cfg)), "0.1% of pool => ok");
assert(!throws(() => assertPriceImpactOk(2, cfg)), "2% impact under cap => ok");
assert(throws(() => assertPriceImpactOk(5, cfg), "price-impact"), "5% impact over cap => blocked");
assert(!throws(() => assertPriceImpactOk(null, cfg)), "unknown impact => not a violation");

rmSync(outDir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
