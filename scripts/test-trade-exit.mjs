// Unit tests for the exit-engine state machine (pure decideSells) and the entry
// guards. No chain, no network — compiles the trade libs with tsc then exercises
// the pure decision logic with synthetic positions/prices.
// Run: node scripts/test-trade-exit.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
// Emit INSIDE the project (not /tmp) so Node can resolve node_modules
// (@solana/web3.js is reachable via the trade-exit import graph at load time).
const outDir = mkdtempSync(join(root, "node_modules", ".trade-test-"));

// Append `.js` to extensionless relative imports/exports in emitted JS so Node
// ESM can resolve the flattened sibling modules.
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
      "src/lib/trade-exit.ts",
      "src/lib/trade-wallet.ts",
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

// tsc (moduleResolution=bundler) emits extensionless relative imports like
// `from "./position-store"`; Node ESM needs explicit `.js`. Rewrite them.
addJsExtensions(outDir);

const { decideSells } = await import(
  pathToFileURL(join(outDir, "trade-exit.js")).href
);

let passed = 0;
let failed = 0;
const green = (m) => console.log(`  \x1b[32mPASS\x1b[0m ${m}`);
const red = (m) => {
  console.log(`  \x1b[31mFAIL\x1b[0m ${m}`);
  failed++;
};
const assert = (cond, msg) => (cond ? (passed++, green(msg)) : red(msg));

const NOW = new Date("2026-10-01T12:00:00Z");

function basePos(overrides = {}) {
  return {
    id: "p1",
    mint: "MintX",
    symbol: "X",
    status: "open",
    mode: "dry-run",
    entryPriceUsd: 1,
    entrySol: 0.1,
    tokenAmount: 1000,
    decimals: 9,
    entryTime: NOW.toISOString(),
    peakPriceUsd: 1,
    trailingArmed: false,
    fills: [{ time: NOW.toISOString(), kind: "buy", pct: 100, priceUsd: 1, sol: 0.1, tokenAmount: 1000, txSig: null, dryRun: true }],
    soldPct: 0,
    realizedPnlSol: 0,
    // Spread top-level overrides FIRST, then set the deep-merged sellStrategy last
    // so a partial sellStrategy override keeps the untouched default fields.
    ...overrides,
    sellStrategy: {
      enabled: true,
      mode: "ladder",
      tiers: [
        { id: "t2", multiplier: 2, sellPercent: 50 },
        { id: "t4", multiplier: 4, sellPercent: 20 },
      ],
      singleTargetMultiplier: 3,
      trailingStopPercent: 20,
      trailingActivateMultiplier: 2,
      stopLossPercent: 0,
      maxHoldMinutes: 0,
      manualHoldPercent: 10,
      ...overrides.sellStrategy,
    },
  };
}

const ctx = (price, opts = {}) => ({
  currentPriceUsd: price,
  now: opts.now ?? NOW,
  killSwitch: opts.killSwitch ?? false,
});

console.log("\n── Ladder take-profit ──");
{
  const pos = basePos();
  const hold = decideSells(pos, ctx(1.5));
  assert(hold === null, "below first tier => hold");

  const t2 = decideSells(pos, ctx(2));
  assert(t2 && t2.reason === "ladder-t2" && t2.pct === 50, "price x2 => sell tier t2 (50%)");

  // After t2 filled, with price at x4 both tiers crossed; t2 already filled, so t4 fires.
  const posAfterT2 = basePos({
    soldPct: 50,
    fills: [
      ...basePos().fills,
      { time: NOW.toISOString(), kind: "sell", pct: 50, priceUsd: 2, sol: 0.1, tokenAmount: 500, txSig: null, dryRun: true, reason: "ladder-t2" },
    ],
  });
  const t4 = decideSells(posAfterT2, ctx(4));
  assert(t4 && t4.reason === "ladder-t4" && t4.pct === 20, "x4 after t2 filled => sell tier t4 (20%)");
  // ceiling = 100 - 10 = 90; 50 + 20 = 70, not exhausted
  assert(t4 && t4.closeAfter === false, "t4 does not close (moon bag + room remains)");
}

console.log("\n── Stop-loss ──");
{
  const pos = basePos({ sellStrategy: { stopLossPercent: 30 } });
  const hold = decideSells(pos, ctx(0.8));
  assert(hold === null, "20% down, SL=30% => hold");
  const sl = decideSells(pos, ctx(0.7));
  assert(sl && sl.reason === "stop-loss" && sl.closeAfter === true, "30% down => stop-loss, close");
  assert(sl && sl.pct === 90, "stop-loss sells sellable ceiling (90%, keeps moon bag)");
}

console.log("\n── Max-hold ──");
{
  const pos = basePos({ sellStrategy: { maxHoldMinutes: 60 } });
  const early = decideSells(pos, ctx(1.1, { now: new Date(NOW.getTime() + 30 * 60_000) }));
  assert(early === null, "30min < 60min => hold");
  const late = decideSells(pos, ctx(1.1, { now: new Date(NOW.getTime() + 61 * 60_000) }));
  assert(late && late.reason === "max-hold" && late.closeAfter === true, "past max-hold => sell remainder");
}

console.log("\n── Single-target ──");
{
  const pos = basePos({ sellStrategy: { mode: "single", singleTargetMultiplier: 3 } });
  assert(decideSells(pos, ctx(2.9)) === null, "below x3 => hold");
  const s = decideSells(pos, ctx(3));
  assert(s && s.reason === "single" && s.pct === 90, "x3 => sell 90% (keep moon bag)");
}

console.log("\n── Trailing ──");
{
  // activate at x2, trail 20%. Peak must arm first.
  const pos = basePos({ sellStrategy: { mode: "trailing", trailingActivateMultiplier: 2, trailingStopPercent: 20 } });
  // Not yet armed (peak=entry=1), price dropping shouldn't trigger.
  assert(decideSells(pos, ctx(1.5)) === null, "pre-activation => hold");
  // Simulate peak reached 3 (armed), now price 2.5 => 2.5 > 3*0.8=2.4 => hold
  const armed = basePos({ sellStrategy: { mode: "trailing", trailingActivateMultiplier: 2, trailingStopPercent: 20 }, peakPriceUsd: 3, trailingArmed: true });
  assert(decideSells(armed, ctx(2.5)) === null, "armed, above trail line => hold");
  const trig = decideSells(armed, ctx(2.3));
  assert(trig && trig.reason === "trailing" && trig.closeAfter === true, "armed, drop below 20% of peak => trailing sell");
}

console.log("\n── Kill-switch & moon bag ──");
{
  const pos = basePos();
  const k = decideSells(pos, ctx(1, { killSwitch: true }));
  assert(k && k.reason === "kill-switch" && k.pct === 90, "kill-switch sells sellable ceiling (90%)");

  // Already sold down to ceiling => nothing left to sell.
  const exhausted = basePos({ soldPct: 90 });
  assert(decideSells(exhausted, ctx(5)) === null, "soldPct at ceiling => hold (moon bag protected)");
}

console.log("\n── Manual mode ──");
{
  const pos = basePos({ sellStrategy: { mode: "manual", stopLossPercent: 50, maxHoldMinutes: 0 } });
  assert(decideSells(pos, ctx(100)) === null, "manual: no take-profit even at x100");
  const sl = decideSells(pos, ctx(0.4));
  assert(sl && sl.reason === "stop-loss", "manual: stop-loss still applies");
}

rmSync(outDir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
