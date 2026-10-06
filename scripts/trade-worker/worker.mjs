// Standalone 24/7 trade worker — runs OUTSIDE Next.js, like scripts/tg-worker.
// It compiles the Next-free trade libs with tsc into a temp dir (same approach as
// scripts/test-*.mjs), then loops:
//   - entry tick: scan recent gems via the running Next app's /api/solana-gems
//     (which itself runs maybeEnterPositions), OR, if the app isn't reachable,
//     just run the exit monitor.
//   - exit tick: monitorPositions() over open positions.
//
// SAFETY: everything respects the dry-run/live gate in trade-config. With
// TRADE_MODE unset or "dry-run" (the default) nothing is ever signed.
//
// Run:  node scripts/trade-worker/worker.mjs
// Env:  SCAN_URL (default http://localhost:3000/api/solana-gems)
//       EXIT_INTERVAL_MS (default 20000), ENTRY_INTERVAL_MS (default 60000)

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

// Minimal env loader since this runs outside Next.js
try {
  const envText = readFileSync(join(root, ".env.local"), "utf8");
  for (const line of envText.split("\n")) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      let val = match[2] || "";
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      else if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      if (!(match[1] in process.env)) process.env[match[1]] = val;
    }
  }
} catch (e) {
  // Ignore if .env.local doesn't exist
}
try {
  const envText = readFileSync(join(root, ".env"), "utf8");
  for (const line of envText.split("\n")) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      let val = match[2] || "";
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      else if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      if (!(match[1] in process.env)) process.env[match[1]] = val;
    }
  }
} catch (e) {}

// tsc (moduleResolution=bundler) emits extensionless relative imports; Node ESM
// needs explicit `.js`. Rewrite them in the flattened output.
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

// Compile INSIDE the project so Node resolves node_modules (@solana/web3.js is
// needed at runtime by the live swap path reachable from the import graph).
const outDir = mkdtempSync(join(root, "node_modules", ".trade-worker-"));

const SCAN_URL = process.env.SCAN_URL || "http://localhost:3000/api/solana-gems";
const EXIT_INTERVAL_MS = Number(process.env.EXIT_INTERVAL_MS || 20_000);
const ENTRY_INTERVAL_MS = Number(process.env.ENTRY_INTERVAL_MS || 60_000);

function log(...args) {
  console.log(`[trade-worker ${new Date().toISOString()}]`, ...args);
}

// Compile the exit engine (pulls in its whole import graph: config, wallet,
// store, swap, jupiter, dexscreener, settings-store). All are Next-free.
log("compiling trade libs...");
try {
  execFileSync(
    join(root, "node_modules/.bin/tsc"),
    [
      "src/lib/trade-exit.ts",
      "src/lib/rugcheck-socket.ts",
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

const { monitorPositions } = await import(
  pathToFileURL(join(outDir, "trade-exit.js")).href
);
const { getTradeConfig } = await import(
  pathToFileURL(join(outDir, "trade-config.js")).href
);
const { connectRugcheckSocket } = await import(
  pathToFileURL(join(outDir, "rugcheck-socket.js")).href
);

const cfg = getTradeConfig();
log(`mode=${cfg.mode} (dry-run unless TRADE_MODE=live AND autoBuyEnabled AND key loaded)`);
log(`exit every ${EXIT_INTERVAL_MS}ms, entry scan every ${ENTRY_INTERVAL_MS}ms`);

let stopping = false;

async function exitTick() {
  try {
    await monitorPositions();
  } catch (e) {
    log("exit tick error:", e?.message ?? e);
  }
}

// Entry runs via the Next app's scan route (empty POST auto-scans recent mints,
// and the route calls maybeEnterPositions). Keeping entry inside the app avoids
// duplicating the enrich→score pipeline here.
async function entryTick() {
  try {
    // Only send tokens seen in the last 30 minutes
    const now = Date.now();
    const validTokens = workerRecentMints
      .filter((t) => now - t.seenAt < 30 * 60_000)
      .slice(0, MAX_SCAN_TOKENS)
      .map(({ mint, symbol, name }) => ({ mint, symbol, name }));

    const payload = validTokens.length > 0 ? { tokens: validTokens } : {};

    const res = await fetch(SCAN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      log(`scan HTTP ${res.status} (is the Next app running?)`);
      return;
    }
    const data = await res.json();
    log(`scan ok: ${data.gems?.length ?? 0} gems scored (sent ${validTokens.length})`);
  } catch (e) {
    log("entry scan unreachable:", e?.message ?? e, "(exit monitor still running)");
  }
}

const exitTimer = setInterval(exitTick, EXIT_INTERVAL_MS);
const entryTimer = setInterval(entryTick, ENTRY_INTERVAL_MS);

// ── Background scanner for tokens when running headless ──
// If the user hasn't opened the dashboard, the Next.js API's recentMints buffer
// stays empty. We maintain our own buffer here and post it to the scanner.
const MAX_SCAN_TOKENS = 15;
let workerRecentMints = [];

function startRugcheckScanner() {
  log("starting background rugcheck stream...");
  connectRugcheckSocket({
    onOpen: () => log("rugcheck stream connected"),
    onEvent: (event) => {
      const raw = event.raw;
      const meta = raw.tokenMeta || {};
      const num = (v) => (typeof v === "number" ? v : null);

      const score = num(raw.score_normalised) ?? 0;
      // Pre-filter exactly like getRecentMints to avoid spamming the Next API
      if (score > 60) return;

      const token = {
        mint: event.mint,
        symbol: typeof meta.symbol === "string" ? meta.symbol : "",
        name: typeof meta.name === "string" ? meta.name : "",
        seenAt: Date.now(),
      };

      const existingIdx = workerRecentMints.findIndex((t) => t.mint === token.mint);
      if (existingIdx !== -1) workerRecentMints.splice(existingIdx, 1);

      workerRecentMints.unshift(token);
      if (workerRecentMints.length > MAX_SCAN_TOKENS * 2) {
        workerRecentMints.length = MAX_SCAN_TOKENS * 2;
      }
    },
    onError: (msg) => log("rugcheck stream error:", msg),
    onClose: (code, reason) => {
      log("rugcheck stream closed:", code, reason, "- reconnecting in 5s");
      if (!stopping) setTimeout(startRugcheckScanner, 5000);
    }
  });
}
startRugcheckScanner();

// Kick both immediately.
exitTick();
entryTick();

function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(exitTimer);
  clearInterval(entryTimer);
  rmSync(outDir, { recursive: true, force: true });
  log("stopped.");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
