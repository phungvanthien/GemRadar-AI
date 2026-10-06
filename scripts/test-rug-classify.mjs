// Unit tests for the rugpull-signal classification that gates write-offs.
// The bug this guards: a healthy, still-in-wallet token was written off as
// "rugpull" after 3 sell failures of ANY kind — including transient Jupiter
// host / RPC failures. consecutiveSellFails must now count ONLY genuine
// "can't be sold" signals (no-route / price-impact / on-chain reject) and skip
// infra noise ("unknown:*", "*-http", unclassified) without being tripped by it.
// Run: node scripts/test-rug-classify.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = mkdtempSync(join(root, "node_modules", ".rug-test-"));

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
      "src/lib/position-store.ts",
      "--outDir", outDir,
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

const { consecutiveSellFails, isRugSellSignal } = await import(
  pathToFileURL(join(outDir, "position-store.js")).href
);

let passed = 0;
let failed = 0;
const green = (m) => console.log(`  \x1b[32mPASS\x1b[0m ${m}`);
const red = (m) => {
  console.log(`  \x1b[31mFAIL\x1b[0m ${m}`);
  failed++;
};
const assert = (cond, msg) => (cond ? (passed++, green(msg)) : red(msg));

const NOW = "2026-10-05T12:00:00Z";

// Build a sell fill with a given errorCode (and matching error string).
function failFill(errorCode, reason = "stop-loss") {
  return {
    time: NOW, kind: "sell", pct: 90, priceUsd: 0, sol: 0, tokenAmount: 0,
    txSig: null, dryRun: false, error: `${errorCode}:boom`, errorCode, reason,
  };
}
function okFill() {
  return {
    time: NOW, kind: "sell", pct: 50, priceUsd: 2, sol: 0.1, tokenAmount: 500,
    txSig: "sig", dryRun: false, reason: "ladder-t2",
  };
}
function posWith(fills) {
  return { id: "p1", symbol: "X", soldPct: 0, entrySol: 0.1, fills };
}

console.log("\n── isRugSellSignal ──");
assert(isRugSellSignal(failFill("quote-no-route")), "quote-no-route is a rug signal");
assert(isRugSellSignal(failFill("price-impact")), "price-impact is a rug signal");
assert(isRugSellSignal(failFill("failed:onchain:custom")), "failed:onchain:* is a rug signal");
assert(!isRugSellSignal(failFill("unknown")), "unknown:* is NOT a rug signal");
assert(!isRugSellSignal(failFill("quote-http")), "quote-http is NOT a rug signal");
assert(!isRugSellSignal(failFill("swap-http")), "swap-http is NOT a rug signal");
assert(!isRugSellSignal(failFill("exception")), "unclassified exception is NOT a rug signal");
assert(!isRugSellSignal({ ...failFill("quote-no-route"), error: undefined }), "no error => not a signal");

console.log("\n── consecutiveSellFails: the reported bug ──");
{
  // The exact failure mode: Jupiter host dead, 5 transient failures in a row.
  const pos = posWith([failFill("unknown"), failFill("unknown"), failFill("unknown"), failFill("unknown"), failFill("unknown")]);
  assert(consecutiveSellFails(pos) === 0, "5x unknown:fetch-failed => 0 rug fails (no false write-off)");
}
{
  const pos = posWith([failFill("quote-http"), failFill("quote-http"), failFill("quote-http")]);
  assert(consecutiveSellFails(pos) === 0, "3x HTTP 5xx => 0 rug fails");
}

console.log("\n── consecutiveSellFails: genuine rug ──");
{
  const pos = posWith([failFill("quote-no-route"), failFill("quote-no-route"), failFill("quote-no-route")]);
  assert(consecutiveSellFails(pos) === 3, "3x no-route => 3 rug fails (reaches threshold)");
}
{
  const pos = posWith([failFill("price-impact"), failFill("failed:onchain:x"), failFill("quote-no-route")]);
  assert(consecutiveSellFails(pos) === 3, "mixed genuine rug codes all count");
}

console.log("\n── consecutiveSellFails: infra noise does not mask or reset a rug run ──");
{
  // Real rug signals with a transient hiccup interleaved: infra is skipped, so
  // the two genuine signals still count — the hiccup neither hides nor inflates.
  const pos = posWith([
    failFill("quote-no-route"),
    failFill("unknown"),       // transient — skipped
    failFill("quote-no-route"),
  ]);
  assert(consecutiveSellFails(pos) === 2, "no-route, [unknown skipped], no-route => 2");
}
{
  // A successful (advancing) sell ends the run even with rug signals before it.
  const pos = posWith([failFill("quote-no-route"), failFill("quote-no-route"), okFill(), failFill("quote-no-route")]);
  assert(consecutiveSellFails(pos) === 1, "advancing sell resets the run");
}
{
  // reconcile bookkeeping is ignored entirely.
  const pos = posWith([failFill("quote-no-route"), { ...failFill("quote-no-route"), reason: "reconcile" }, failFill("quote-no-route")]);
  assert(consecutiveSellFails(pos) === 2, "reconcile fill is skipped, not counted");
}

rmSync(outDir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
