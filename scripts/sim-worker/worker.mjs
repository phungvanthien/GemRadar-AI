// Standalone SIMULATION worker — writes to the SAME alphahunter-positions.json
// ledger the dashboard reads, so you can watch fake buys/sells/P&L update live
// in the Danh mục (Portfolio) view with ZERO changes to the app.
//
// What it does, on a loop:
//   - periodically "buys" a new synthetic gem (opens a dry-run position)
//   - every tick, random-walks each open gem's price and runs the REAL exit
//     state machine (decideSells) against it, recording sells exactly like the
//     live worker would (ladder tiers, stop-loss, trailing, moon bag).
//
// SAFETY: pure simulation. Mode is hard-coded "dry-run", no wallet, no network,
// no signing. It only reads/writes the local JSON ledger. Nothing touches chain.
//
// Run:  npm run sim-worker
// Env:  SIM_TICK_MS         (default 5000)   price tick + exit check cadence
//       SIM_BUY_EVERY_MS    (default 30000)  how often a new gem is bought
//       SIM_MAX_OPEN        (default 6)      cap on simultaneously-held gems
//       SIM_RESET           ("1" to wipe the ledger on startup)

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

const root = fileURLToPath(new URL("../..", import.meta.url));
// Compile inside node_modules so the trade-exit import graph (@solana/web3.js)
// resolves at load time — same pattern as the other script workers.
const outDir = mkdtempSync(join(root, "node_modules", ".sim-worker-"));

const TICK_MS = Number(process.env.SIM_TICK_MS || 5_000);
const BUY_EVERY_MS = Number(process.env.SIM_BUY_EVERY_MS || 30_000);
const MAX_OPEN = Number(process.env.SIM_MAX_OPEN || 6);
const RESET = process.env.SIM_RESET === "1";

function log(...a) {
  console.log(`[sim-worker ${new Date().toISOString()}]`, ...a);
}

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

log("compiling trade libs...");
try {
  execFileSync(
    join(root, "node_modules/.bin/tsc"),
    [
      "src/lib/trade-exit.ts",
      "src/lib/position-store.ts",
      "src/lib/settings-store.ts",
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
const { loadSettings } = await import(pathToFileURL(join(outDir, "settings-store.js")).href);

// The store writes alphahunter-positions.json relative to process.cwd(). The
// dashboard's /api/portfolio reads it from the project root (its own cwd), so we
// MUST run with cwd = project root for both to share the same file.
process.chdir(root);

const SOL_USD = 200; // fixed SOL/USD for sim P&L math (dashboard converts live)

// Pull the sell strategy + buy size from the user's real settings so the sim
// honours whatever is configured in the Cài đặt (Settings) panel. Falls back to
// the ladder defaults when no settings file exists.
const settings = loadSettings();
const SELL_STRATEGY = settings.sellStrategy;
const BUY_SOL = settings.buyVolumeSol > 0 ? settings.buyVolumeSol : 0.1;

// Fraction of new gems that "rug" (trend down into stop-loss). The rest moon.
const RUG_RATE = Number(process.env.SIM_RUG_RATE || 0.4);
// Stop-loss the sim enforces so rug gems actually exit on a loss. Honour the
// user's configured stop-loss if they set one (>0); otherwise force this.
const SIM_STOP_LOSS_PCT =
  SELL_STRATEGY.stopLossPercent > 0 ? SELL_STRATEGY.stopLossPercent : 35;
// Max-hold (real minutes) applied to MOON gems so a profitable runner eventually
// sells its remainder (keeping the moon bag) and CLOSES at a profit — otherwise
// winners sit "open" forever and the closed-position win-rate shows only losers.
// 0 disables (runners stay open). For a fast demo set e.g. SIM_MOON_MAX_HOLD_MIN=1.
const SIM_MOON_MAX_HOLD_MIN = Number(process.env.SIM_MOON_MAX_HOLD_MIN || 2);

log(`strategy mode=${SELL_STRATEGY.mode}, buy=${BUY_SOL} SOL, moon bag=${SELL_STRATEGY.manualHoldPercent}%`);
log(`scenario: ${Math.round(RUG_RATE * 100)}% rug (stop-loss ${SIM_STOP_LOSS_PCT}%), ${Math.round((1 - RUG_RATE) * 100)}% moon (max-hold ${SIM_MOON_MAX_HOLD_MIN || "off"}m)`);
log(`tick=${TICK_MS}ms, buy a new gem every ${BUY_EVERY_MS}ms, max ${MAX_OPEN} open`);

// A pool of plausible-looking fake gems to cycle through.
const NAMES = [
  "PEPE2", "WIFHAT", "BONKAI", "MOONPIG", "SOLZILLA", "DOGGO", "CATNIP",
  "GIGACHAD", "FOMO", "APEX", "NEKO", "LAMBO", "DEGEN", "ROCKET", "SHILL",
];
let nameIdx = 0;
function nextName() {
  const n = NAMES[nameIdx % NAMES.length];
  nameIdx++;
  return `${n}${nameIdx > NAMES.length ? Math.floor(nameIdx / NAMES.length) : ""}`;
}

function randomMint() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789";
  let s = "Sim";
  for (let i = 0; i < 41; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// Per-mint live sim price (USD). Entry price is random; walk it each tick.
const simPrice = new Map();
// Per-mint trend bias: "moon" (upward drift → hits ladder tiers) or "rug"
// (downward drift → hits stop-loss). Assigned once at buy time.
const simTrend = new Map();

async function reset() {
  // Writing an empty store is how we "wipe" — same shape readStore expects.
  const empty = { positions: {}, daily: { date: "", tradesOpened: 0 } };
  writeFileSync(
    join(root, "alphahunter-positions.json"),
    JSON.stringify(empty, null, 2),
    "utf8",
  );
  log("ledger reset (SIM_RESET=1)");
}

async function buyNewGem() {
  const open = await store.getOpenPositions();
  if (open.length >= MAX_OPEN) return;

  const symbol = nextName();
  const mint = randomMint();
  // Entry price in a memecoin-ish range.
  const entryPrice = Number((Math.random() * 0.004 + 0.0002).toFixed(7));
  const tokenAmount = (BUY_SOL * SOL_USD) / entryPrice;
  const now = new Date();

  const trend = Math.random() < RUG_RATE ? "rug" : "moon";
  simPrice.set(mint, entryPrice);
  simTrend.set(mint, trend);

  // Each gem is managed by a snapshot of the strategy with stop-loss enabled, so
  // rug gems actually exit on a loss (the settings default stop-loss is 0). Moon
  // gems also get a max-hold so a winner eventually closes at a profit instead of
  // sitting open forever — keeps the closed-position win-rate honest.
  const gemStrategy = {
    ...SELL_STRATEGY,
    stopLossPercent: SIM_STOP_LOSS_PCT,
    maxHoldMinutes:
      trend === "moon" && SIM_MOON_MAX_HOLD_MIN > 0
        ? SIM_MOON_MAX_HOLD_MIN
        : SELL_STRATEGY.maxHoldMinutes,
  };

  await store.openPosition(
    {
      mint,
      symbol,
      mode: "dry-run",
      entryPriceUsd: entryPrice,
      entrySol: BUY_SOL,
      tokenAmount,
      decimals: 9,
      sellStrategy: gemStrategy,
      entryFill: {
        time: now.toISOString(),
        kind: "buy",
        pct: 100,
        priceUsd: entryPrice,
        sol: BUY_SOL,
        tokenAmount,
        txSig: null,
        dryRun: true,
      },
    },
    now,
  );
  log(`BUY  ${symbol} (${trend})  ${BUY_SOL} SOL @ $${entryPrice}`);
}

// Random-walk a price per the gem's trend, so the sim produces a mix of winners
// (moon → hit ladder tiers) and losers (rug → fall into stop-loss).
function walk(price, entry, trend) {
  const moon = trend !== "rug";
  // moon: +1.5% drift; rug: -6% drift so it reaches a 35% stop-loss in a few
  // ticks. Rug volatility is a touch lower so the decline reads clearly.
  const drift = moon ? 0.015 : -0.06;
  const vol = moon ? 0.12 : 0.1;
  const shock = (Math.random() - 0.5) * 2 * vol;
  let next = price * (1 + drift + shock);
  // Floor so it never goes to zero (dust). Rug bottoms lower (10%) so a 35%
  // stop-loss always triggers before the floor; moon bottoms at 15%.
  next = Math.max(next, entry * (moon ? 0.15 : 0.1));
  return Number(next.toFixed(8));
}

async function tick() {
  const open = await store.getOpenPositions();
  if (open.length === 0) return;

  for (const pos of open) {
    const entry = pos.entryPriceUsd;
    const prev = simPrice.get(pos.mint) ?? entry;
    const trend = simTrend.get(pos.mint) ?? "moon";
    const price = walk(prev, entry, trend);
    simPrice.set(pos.mint, price);

    const now = new Date();

    // Mirror the live worker: persist peak + trailing latch before deciding.
    const peak = Math.max(pos.peakPriceUsd, price);
    const armed =
      pos.trailingArmed ||
      (SELL_STRATEGY.trailingActivateMultiplier > 0 &&
        peak >= entry * SELL_STRATEGY.trailingActivateMultiplier);
    await store.updatePeak(pos.id, price, armed);

    const action = decideSells(
      { ...pos, peakPriceUsd: peak, trailingArmed: armed },
      { currentPriceUsd: price, now, killSwitch: false },
    );
    if (!action || action.pct <= 1e-9) continue;

    const tokensSold = pos.tokenAmount * (action.pct / 100);
    const solOut = (tokensSold * price) / SOL_USD;

    const updated = await store.recordSellFill(
      pos.id,
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
    const x = (price / entry).toFixed(2);
    log(`SELL ${pos.symbol} ${action.pct}% [${action.reason}] @ ${x}x  ~${solOut.toFixed(4)} SOL${action.closeAfter ? " (close)" : ""}`);

    // Position closed → drop its per-mint sim state so the maps don't grow.
    if (updated?.status === "closed") {
      simPrice.delete(pos.mint);
      simTrend.delete(pos.mint);
    }
  }
}

// Serialize all ledger access through one promise chain. The store writes via
// temp-file + atomic rename; two overlapping writes (a buy timer firing during a
// tick) would otherwise race on the same .tmp path and throw ENOENT on rename.
let chain = Promise.resolve();
function serialize(fn) {
  chain = chain.then(fn, fn); // keep the chain alive even if a step rejects
  return chain;
}

if (RESET) await reset();

// Kick one buy immediately so the dashboard isn't empty on first load.
await buyNewGem();

const tickTimer = setInterval(() => {
  serialize(() => tick().catch((e) => log("tick error:", e?.message ?? e)));
}, TICK_MS);
const buyTimer = setInterval(() => {
  serialize(() => buyNewGem().catch((e) => log("buy error:", e?.message ?? e)));
}, BUY_EVERY_MS);

log("running. Open the dashboard → Danh mục to watch. Ctrl+C to stop.");

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(tickTimer);
  clearInterval(buyTimer);
  rmSync(outDir, { recursive: true, force: true });
  log("stopped.");
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
