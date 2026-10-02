// Tests the Phase 6 reconciliation path (position-store): needsReconcile
// detection and reconcileFromChain ledger math. These are the safety net that
// turns an ambiguous ("unknown") live sell into a correct ledger by trusting the
// on-chain balance. No chain — the store writes to a temp JSON file.
// Run: node scripts/test-trade-reconcile.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = mkdtempSync(join(root, "node_modules", ".trade-rec-test-"));
// Run the store against a throwaway cwd so alphahunter-positions.json is isolated.
const workDir = mkdtempSync(join(root, "node_modules", ".trade-rec-cwd-"));

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
    ["src/lib/position-store.ts", "--outDir", outDir, "--module", "esnext",
     "--target", "es2022", "--moduleResolution", "bundler", "--skipLibCheck", "--esModuleInterop"],
    { cwd: root, stdio: "inherit" },
  );
} catch (e) {
  console.error("tsc failed:", e.message);
  process.exit(1);
}
addJsExtensions(outDir);

// The store resolves its file via process.cwd(); point cwd at the throwaway dir.
process.chdir(workDir);

const store = await import(pathToFileURL(join(outDir, "position-store.js")).href);

let passed = 0, failed = 0;
const green = (m) => console.log(`  \x1b[32mPASS\x1b[0m ${m}`);
const red = (m) => { console.log(`  \x1b[31mFAIL\x1b[0m ${m}`); failed++; };
const assert = (c, m) => (c ? (passed++, green(m)) : red(m));
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

const SELL_STRATEGY = {
  enabled: true, mode: "ladder", tiers: [{ id: "t2", multiplier: 2, sellPercent: 50 }],
  singleTargetMultiplier: 3, trailingStopPercent: 20, trailingActivateMultiplier: 2,
  stopLossPercent: 0, maxHoldMinutes: 0, manualHoldPercent: 10,
};

async function freshLivePosition() {
  return store.openPosition({
    mint: "MintRec", symbol: "REC", mode: "live",
    entryPriceUsd: 1, entrySol: 0.1, tokenAmount: 1000, decimals: 9,
    sellStrategy: SELL_STRATEGY,
    entryFill: { time: "t", kind: "buy", pct: 100, priceUsd: 1, sol: 0.1, tokenAmount: 1000, txSig: "sig0", dryRun: false },
  });
}

console.log("\n── needsReconcile detection ──");
{
  const pos = await freshLivePosition();
  assert(store.needsReconcile(pos) === false, "fresh position (only a buy) => no reconcile");

  // A confirmed sell doesn't need reconcile.
  await store.recordSellFill(pos.id, { time: "t", kind: "sell", pct: 50, priceUsd: 2, sol: 0.1, tokenAmount: 500, txSig: "sig1", dryRun: false, reason: "ladder-t2" }, {});
  let open = (await store.getOpenPositions()).find((p) => p.id === pos.id);
  assert(open && store.needsReconcile(open) === false, "confirmed sell => no reconcile");

  // An ambiguous ("unknown:") sell DOES.
  await store.recordSellFill(pos.id, { time: "t", kind: "sell", pct: 20, priceUsd: 3, sol: 0, tokenAmount: 200, txSig: "sig2", dryRun: false, error: "unknown:confirm-timeout", reason: "ladder-t4" }, {});
  open = (await store.getOpenPositions()).find((p) => p.id === pos.id);
  assert(open && store.needsReconcile(open) === true, "ambiguous unknown sell => needs reconcile");
  // The errored fill must NOT have advanced soldPct beyond the confirmed 50.
  assert(open && near(open.soldPct, 50), `errored fill didn't advance soldPct (is ${open?.soldPct})`);
}

console.log("\n── reconcileFromChain ledger math ──");
{
  // Case A: chain shows 400 of 1000 tokens still held => 60% effectively sold.
  const posA = await freshLivePosition();
  await store.recordSellFill(posA.id, { time: "t", kind: "sell", pct: 20, priceUsd: 3, sol: 0, tokenAmount: 200, txSig: null, dryRun: false, error: "unknown:confirm-timeout", reason: "ladder-t4" }, {});
  const fixedA = await store.reconcileFromChain(posA.id, 400);
  assert(fixedA && near(fixedA.soldPct, 60), `held 400/1000 => soldPct 60 (is ${fixedA?.soldPct})`);
  assert(fixedA && fixedA.status === "open", "60% sold, ceiling 90% => still open");
  assert(fixedA && fixedA.fills.at(-1)?.reason === "reconcile", "reconcile marker fill appended");

  // Case B: chain shows 100 of 1000 => 90% sold == ceiling => closed.
  const posB = await freshLivePosition();
  await store.recordSellFill(posB.id, { time: "t", kind: "sell", pct: 0, priceUsd: 3, sol: 0, tokenAmount: 0, txSig: null, dryRun: false, error: "unknown:x", reason: "ladder-t4" }, {});
  const fixedB = await store.reconcileFromChain(posB.id, 100);
  assert(fixedB && near(fixedB.soldPct, 90), `held 100/1000 => soldPct 90 (is ${fixedB?.soldPct})`);
  assert(fixedB && fixedB.status === "closed" && fixedB.closedReason === "reconciled-exhausted", "at ceiling => closed as reconciled-exhausted");

  // Case C: chain shows full 1000 => sell never landed => soldPct back to 0.
  const posC = await freshLivePosition();
  await store.recordSellFill(posC.id, { time: "t", kind: "sell", pct: 0, priceUsd: 3, sol: 0, tokenAmount: 0, txSig: null, dryRun: false, error: "unknown:x", reason: "ladder-t4" }, {});
  const fixedC = await store.reconcileFromChain(posC.id, 1000);
  assert(fixedC && near(fixedC.soldPct, 0), `held full 1000 => soldPct 0, sell didn't land (is ${fixedC?.soldPct})`);
  assert(fixedC && store.needsReconcile(fixedC) === false, "after reconcile, needsReconcile clears (last fill is reconcile marker)");
}

process.chdir(root);
rmSync(outDir, { recursive: true, force: true });
rmSync(workDir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
