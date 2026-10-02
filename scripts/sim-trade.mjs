// End-to-end BUY/SELL simulation in DRY-RUN. Exercises the REAL ledger
// (position-store) and the REAL pure exit state machine (decideSells) against a
// scripted price path — no network, no wallet, no real transactions.
//
// It opens a synthetic position for a fake gem, then "ticks" the exit engine
// over a rising-then-falling price series, recording each sell fill exactly as
// the live worker would, and prints the resulting ledger + realized P&L.
//
// Run:  node scripts/sim-trade.mjs
// Safe: never signs anything; mode is hard-coded "dry-run".

import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = mkdtempSync(join(root, "node_modules", ".sim-trade-"));

// Isolate the ledger so the sim never touches a real alphahunter-positions.json.
const SIM_STORE = join(outDir, "sim-positions.json");

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

const store = await import(pathToFileURL(join(outDir, "position-store.js")).href);
const { decideSells } = await import(pathToFileURL(join(outDir, "trade-exit.js")).href);

// Redirect the store to the sandbox file (STORE_PATH is a module const, so we
// point cwd-derived path at the sandbox by monkeypatching the fs the module
// uses is not possible; instead we rely on the store writing to process.cwd().
// Simplest isolation: run with cwd=outDir so alphahunter-positions.json lands
// there). We achieve that by chdir before any store call.
process.chdir(outDir);

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  grn: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyn: (s) => `\x1b[36m${s}\x1b[0m`,
  ylw: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

// ── The fake gem + strategy ───────────────────────────────────────────────
const GEM = { mint: "SiMg3mXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", symbol: "SIMGEM", decimals: 9 };
const ENTRY_PRICE = 0.001; // USD per token
const BUY_SOL = 0.1;
// token amount if 1 SOL ≈ $200: 0.1 SOL = $20 => 20 / 0.001 = 20,000 tokens
const SOL_USD = 200;
const TOKEN_AMOUNT = (BUY_SOL * SOL_USD) / ENTRY_PRICE;

const SELL_STRATEGY = {
  enabled: true,
  mode: "ladder",
  tiers: [
    { id: "t2", multiplier: 2, sellPercent: 50 },
    { id: "t4", multiplier: 4, sellPercent: 20 },
    { id: "t8", multiplier: 8, sellPercent: 10 },
  ],
  singleTargetMultiplier: 3,
  trailingStopPercent: 20,
  trailingActivateMultiplier: 2,
  stopLossPercent: 40,
  maxHoldMinutes: 0,
  manualHoldPercent: 10, // 10% moon bag never auto-sold
};

// Scripted price path (USD). Rises to 8x, dips, recovers — triggers t2, t4, t8.
const PRICE_PATH = [
  0.0012, 0.0018, 0.0021, 0.0035, 0.0042, 0.0061, 0.0079, 0.0085, 0.0070, 0.0052,
];

const t0 = new Date("2026-10-01T12:00:00Z");
const tickTime = (i) => new Date(t0.getTime() + (i + 1) * 60_000);

function fmtUsd(n) { return `$${n.toFixed(6)}`; }
function mult(p) { return (p / ENTRY_PRICE).toFixed(2) + "x"; }

// ── 1) BUY (open the position) ────────────────────────────────────────────
console.log(C.bold("\n═══ AlphaHunter trade simulation (DRY-RUN) ═══\n"));
console.log(`Gem:        ${C.cyn(GEM.symbol)}  (${GEM.mint.slice(0, 8)}…)`);
console.log(`Strategy:   ladder ${SELL_STRATEGY.tiers.map((t) => `${t.multiplier}x→${t.sellPercent}%`).join(", ")}  | stop-loss ${SELL_STRATEGY.stopLossPercent}% | moon bag ${SELL_STRATEGY.manualHoldPercent}%`);
console.log(`Entry:      ${C.grn("BUY")} ${BUY_SOL} SOL @ ${fmtUsd(ENTRY_PRICE)}  → ${TOKEN_AMOUNT.toLocaleString()} ${GEM.symbol}\n`);

const pos = await store.openPosition(
  {
    mint: GEM.mint,
    symbol: GEM.symbol,
    mode: "dry-run",
    entryPriceUsd: ENTRY_PRICE,
    entrySol: BUY_SOL,
    tokenAmount: TOKEN_AMOUNT,
    decimals: GEM.decimals,
    sellStrategy: SELL_STRATEGY,
    entryFill: {
      time: t0.toISOString(),
      kind: "buy",
      pct: 100,
      priceUsd: ENTRY_PRICE,
      sol: BUY_SOL,
      tokenAmount: TOKEN_AMOUNT,
      txSig: null,
      dryRun: true,
    },
  },
  t0,
);

// ── 2) EXIT TICKS (drive the real decideSells state machine) ──────────────
console.log(C.bold("Price ticks → exit decisions:\n"));
let current = pos;

for (let i = 0; i < PRICE_PATH.length; i++) {
  const price = PRICE_PATH[i];
  const now = tickTime(i);

  // Re-read the live position each tick (soldPct/fills advance across ticks).
  const open = await store.getOpenPositions();
  current = open.find((p) => p.id === pos.id) ?? null;
  if (!current) {
    console.log(`  ${C.dim(`tick ${i + 1}`)}  ${fmtUsd(price)} (${mult(price)})  → position closed, stop ticking`);
    break;
  }

  // Mirror the worker: persist peak + trailing latch before deciding.
  const peak = Math.max(current.peakPriceUsd, price);
  const armed =
    current.trailingArmed ||
    (SELL_STRATEGY.trailingActivateMultiplier > 0 &&
      peak >= ENTRY_PRICE * SELL_STRATEGY.trailingActivateMultiplier);
  await store.updatePeak(current.id, price, armed);

  const action = decideSells(
    { ...current, peakPriceUsd: peak, trailingArmed: armed },
    { currentPriceUsd: price, now, killSwitch: false },
  );

  const label = `  ${C.dim(`tick ${i + 1}`.padEnd(7))} ${fmtUsd(price)} (${mult(price).padStart(6)})`;

  if (!action || action.pct <= 1e-9) {
    console.log(`${label}  → ${C.dim("hold")}`);
    continue;
  }

  // Simulate the fill: SOL received = (tokens sold) * price / SOL_USD.
  const tokensSold = current.tokenAmount * (action.pct / 100);
  const solOut = (tokensSold * price) / SOL_USD;

  await store.recordSellFill(
    current.id,
    {
      time: now.toISOString(),
      kind: "sell",
      pct: action.pct,
      priceUsd: price,
      sol: solOut,
      tokenAmount: tokensSold,
      txSig: null,
      dryRun: true,
      reason: action.reason,
    },
    { closeReason: action.reason, forceClose: action.closeAfter },
    now,
  );

  console.log(
    `${label}  → ${C.grn("SELL")} ${String(action.pct).padStart(3)}% ` +
      `[${C.ylw(action.reason)}] ~${solOut.toFixed(4)} SOL` +
      (action.closeAfter ? C.red("  (close)") : ""),
  );
}

// ── 3) LEDGER SUMMARY ─────────────────────────────────────────────────────
const all = await store.getAllPositions();
const final = all.find((p) => p.id === pos.id);

console.log(C.bold("\n═══ Position ledger ═══\n"));
console.log(`Status:         ${final.status === "closed" ? C.red(final.status) : C.grn(final.status)}${final.closedReason ? C.dim(`  (${final.closedReason})`) : ""}`);
console.log(`Sold:           ${final.soldPct.toFixed(1)}% of original  (moon bag: ${SELL_STRATEGY.manualHoldPercent}% held)`);
console.log(`Peak price:     ${fmtUsd(final.peakPriceUsd)} (${mult(final.peakPriceUsd)})`);
console.log(`Realized P&L:   ${pnlColor(final.realizedPnlSol)} SOL  (entry cost ${BUY_SOL} SOL)`);

const remainingPct = Math.max(0, 100 - final.soldPct);
const lastPrice = PRICE_PATH[PRICE_PATH.length - 1];
const unreal = store.computeUnrealizedPnlSol(final, lastPrice);
console.log(`Unrealized P&L: ${pnlColor(unreal)} SOL  (${remainingPct.toFixed(1)}% still held @ ${fmtUsd(lastPrice)})`);
console.log(`Total P&L:      ${pnlColor(final.realizedPnlSol + unreal)} SOL`);

console.log(C.bold("\nFills:"));
for (const f of final.fills) {
  const tag = f.kind === "buy" ? C.grn("BUY ") : C.red("SELL");
  console.log(
    `  ${C.dim(f.time.slice(11, 19))} ${tag} ${String(f.pct).padStart(3)}% ` +
      `@ ${fmtUsd(f.priceUsd)}  ${f.sol.toFixed(4)} SOL` +
      (f.reason ? C.dim(`  [${f.reason}]`) : ""),
  );
}

function pnlColor(n) {
  const s = (n >= 0 ? "+" : "") + n.toFixed(5);
  return n >= 0 ? C.grn(s) : C.red(s);
}

// Cleanup the sandbox.
process.chdir(root);
rmSync(outDir, { recursive: true, force: true });
console.log("");
