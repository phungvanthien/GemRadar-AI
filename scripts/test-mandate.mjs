// Unit tests for the mandate capital layer (pure computeAccounting /
// evaluateEntryGate / shouldForceLiquidate). No chain, no network, no fs — the
// mandate decision logic is pure. Compiles src/lib/mandate.ts with tsc then
// exercises it with synthetic portfolio states.
// Run: node scripts/test-mandate.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = mkdtempSync(join(root, "node_modules", ".mandate-test-"));

// tsc (moduleResolution=bundler) emits extensionless relative imports; Node ESM
// needs explicit `.js`. (mandate.ts has none, but keep the helper for parity.)
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
      "src/lib/mandate.ts",
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

const { computeAccounting, evaluateEntryGate, shouldForceLiquidate, DEFAULT_MANDATE } =
  await import(pathToFileURL(join(outDir, "mandate.js")).href);

let passed = 0;
let failed = 0;
const green = (m) => console.log(`  \x1b[32mPASS\x1b[0m ${m}`);
const red = (m) => {
  console.log(`  \x1b[31mFAIL\x1b[0m ${m}`);
  failed++;
};
const assert = (cond, msg) => (cond ? (passed++, green(msg)) : red(msg));
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// A mandate with sensible, ACTIVE defaults for the happy path. principal 10 SOL,
// 10% per trade (=1 SOL), reserve 0.5, max 5 open, 25% drawdown, 15% daily loss.
function mandate(overrides = {}) {
  return {
    ...DEFAULT_MANDATE,
    status: "active",
    principalSol: 10,
    perTradePctOfPrincipal: 10,
    reserveSol: 0.5,
    maxOpenPositions: 5,
    maxDrawdownPct: 25,
    dailyLossLimitPct: 15,
    onDrawdownBreach: "halt",
    startedAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

// maxSolPerTrade is the operator hard cap from trade-config (default 0.25, but we
// use a roomy 5 here so the mandate % is the binding constraint unless noted).
const acct = (m, { deployed = 0, realized = 0, unrealized = 0, maxSolPerTrade = 5 } = {}) =>
  computeAccounting({
    mandate: m,
    deployedSol: deployed,
    realizedPnlSol: realized,
    unrealizedPnlSol: unrealized,
    maxSolPerTrade,
  });

console.log("\n── Accounting ──");
{
  const m = mandate();
  const a = acct(m);
  assert(near(a.availableSol, 9.5), "available = principal - deployed - reserve (10-0-0.5=9.5)");
  assert(near(a.perTradeSizeSol, 1), "perTradeSize = 10% of 10 = 1 SOL");
  assert(near(a.equitySol, 10), "equity = principal when no P&L");
  assert(near(a.drawdownPct, 0), "drawdown 0% at breakeven");

  const a2 = acct(m, { deployed: 3, realized: 0.4, unrealized: -0.1 });
  assert(near(a2.availableSol, 6.5), "available drops with deployed (10-3-0.5=6.5)");
  assert(near(a2.equitySol, 10.3), "equity = 10 + 0.4 - 0.1 = 10.3");
  assert(near(a2.drawdownPct, 3), "drawdown +3% when equity 10.3 on 10 principal");
}

console.log("\n── Sizing clamps ──");
{
  // Operator cap binds below the mandate %: 10% of 10 = 1, but cap = 0.25.
  const a = acct(mandate(), { maxSolPerTrade: 0.25 });
  assert(near(a.perTradeSizeSol, 0.25), "perTradeSize clamped to maxSolPerTrade (0.25)");

  // availableSol binds: nearly all capital deployed.
  const a2 = acct(mandate(), { deployed: 9.2 }); // available = 10-9.2-0.5 = 0.3
  assert(near(a2.availableSol, 0.3), "available = 0.3 when 9.2 deployed");
  assert(near(a2.perTradeSizeSol, 0.3), "perTradeSize clamped to available (0.3 < 1)");
}

console.log("\n── Entry gate: happy path ──");
{
  const m = mandate();
  const a = acct(m);
  const g = evaluateEntryGate({ mandate: m, acct: a, openCount: 2, realizedTodaySol: 0 });
  assert(g.allowed && g.reason === "ok", "active + room + capital => ok");
  assert(near(g.sizeSol, 1) && g.liquidate === false, "ok returns size 1, no liquidate");
}

console.log("\n── Entry gate: status ──");
{
  for (const st of ["paused", "stopped"]) {
    const m = mandate({ status: st });
    const g = evaluateEntryGate({ mandate: m, acct: acct(m), openCount: 0, realizedTodaySol: 0 });
    assert(!g.allowed && g.reason === "mandate-not-active", `status=${st} => blocked`);
  }
}

console.log("\n── Entry gate: drawdown breach ──");
{
  // equity 7.4 on 10 principal => -26% <= -25% floor.
  const m = mandate();
  const a = acct(m, { realized: -2.6 });
  assert(a.drawdownPct <= -25, "setup: drawdown is past the floor");
  const g = evaluateEntryGate({ mandate: m, acct: a, openCount: 0, realizedTodaySol: 0 });
  assert(!g.allowed && g.reason === "drawdown-breach", "drawdown past floor => blocked");
  assert(g.liquidate === false, "halt mode => no liquidate");

  const mLiq = mandate({ onDrawdownBreach: "halt-and-liquidate" });
  const g2 = evaluateEntryGate({ mandate: mLiq, acct: acct(mLiq, { realized: -2.6 }), openCount: 0, realizedTodaySol: 0 });
  assert(g2.liquidate === true, "halt-and-liquidate => liquidate flag set");
  assert(shouldForceLiquidate(mLiq, acct(mLiq, { realized: -2.6 })) === true, "shouldForceLiquidate true on breach (liq mode)");
  assert(shouldForceLiquidate(m, acct(m, { realized: -2.6 })) === false, "shouldForceLiquidate false in halt mode");

  // Just above the floor must NOT breach: equity 7.6 => -24%.
  const g3 = evaluateEntryGate({ mandate: m, acct: acct(m, { realized: -2.4 }), openCount: 0, realizedTodaySol: 0 });
  assert(g3.allowed, "-24% (above -25% floor) => still allowed");
}

console.log("\n── Entry gate: daily loss limit ──");
{
  const m = mandate(); // dailyLossLimitPct 15% of 10 = 1.5 SOL floor
  const a = acct(m);
  const g = evaluateEntryGate({ mandate: m, acct: a, openCount: 0, realizedTodaySol: -1.5 });
  assert(!g.allowed && g.reason === "daily-loss-limit", "realized today at -1.5 (=-15%) => blocked");
  const g2 = evaluateEntryGate({ mandate: m, acct: a, openCount: 0, realizedTodaySol: -1.49 });
  assert(g2.allowed, "realized today -1.49 (above floor) => allowed");
}

console.log("\n── Entry gate: max open ──");
{
  const m = mandate();
  const g = evaluateEntryGate({ mandate: m, acct: acct(m), openCount: 5, realizedTodaySol: 0 });
  assert(!g.allowed && g.reason === "max-open-reached", "openCount=max => blocked");
}

console.log("\n── Entry gate: insufficient available ──");
{
  const m = mandate();
  // deployed 9.6 => available = 10-9.6-0.5 = -0.1 -> floored 0.
  const a = acct(m, { deployed: 9.6 });
  assert(near(a.availableSol, 0), "available floored at 0");
  const g = evaluateEntryGate({ mandate: m, acct: a, openCount: 1, realizedTodaySol: 0 });
  assert(!g.allowed && g.reason === "insufficient-available", "no capital => blocked");
}

console.log("\n── Gate ordering (drawdown beats max-open) ──");
{
  const m = mandate();
  const a = acct(m, { realized: -3 }); // -30% breach
  const g = evaluateEntryGate({ mandate: m, acct: a, openCount: 99, realizedTodaySol: -5 });
  assert(g.reason === "drawdown-breach", "drawdown checked before max-open/daily");
}

rmSync(outDir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
