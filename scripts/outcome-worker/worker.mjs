// Outcome reconciliation worker. On a loop, it walks the gem-outcome ledger
// (alphahunter-gem-outcomes.json, written by /api/solana-gems) and, for each row
// whose 1h / 24h / 7d horizon has arrived but isn't yet sampled, re-fetches the
// token's price from Jupiter and records it. The 24h sample classifies the row
// as rug / flat / pump; those aggregates feed back into the AI scoring prompt
// (getScoringCalibration) so the model learns from its own past calls.
//
// SAFETY: read-only against chain data. It only reads Jupiter (free, public) and
// reads/writes the local JSON ledger. No wallet, no signing, no trades.
//
// Run:  npm run outcome-worker
// Env:  OUTCOME_TICK_MS  (default 300000 = 5 min)  how often to reconcile
//       OUTCOME_ONCE     ("1" to run a single pass then exit — for cron/CI)

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
// Compile inside node_modules so relative-import rewriting matches the other
// workers' pattern (sim-worker, trade-worker).
const outDir = mkdtempSync(join(root, "node_modules", ".outcome-worker-"));

const TICK_MS = Number(process.env.OUTCOME_TICK_MS || 300_000);
const ONCE = process.env.OUTCOME_ONCE === "1";

function log(...a) {
  console.log(`[outcome-worker ${new Date().toISOString()}]`, ...a);
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

log("compiling libs...");
try {
  execFileSync(
    join(root, "node_modules/.bin/tsc"),
    [
      "src/lib/gem-outcomes-store.ts",
      "src/lib/jupiter.ts",
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

const store = await import(pathToFileURL(join(outDir, "gem-outcomes-store.js")).href);
const { getJupiterPrices } = await import(pathToFileURL(join(outDir, "jupiter.js")).href);

// The store writes alphahunter-gem-outcomes.json relative to process.cwd(). The
// Next.js route writes it from the project root, so run with cwd = root to share
// the same file.
process.chdir(root);

async function reconcileOnce() {
  const all = await store.getAllOutcomes();
  const now = new Date();

  // Collect every (row, horizon) that's due but unsampled, then fetch all the
  // needed prices in one Jupiter batch.
  const due = [];
  for (const o of all) {
    const id = `${o.mint}-${Date.parse(o.scoredAt)}`;
    for (const horizon of store.pendingHorizons(o, now)) {
      due.push({ id, mint: o.mint, horizon });
    }
  }

  if (due.length === 0) {
    log(`nothing due (${all.length} rows total)`);
    return;
  }

  const mints = [...new Set(due.map((d) => d.mint))];
  const prices = await getJupiterPrices(mints);

  let sampled = 0;
  for (const d of due) {
    // A mint Jupiter no longer knows is absent from the map → price null, which
    // the store treats as a dead-token signal (counts toward rug at 24h).
    const price = prices.get(d.mint)?.usdPrice ?? null;
    await store.recordSample(d.id, d.horizon, price);
    sampled++;
  }
  log(`sampled ${sampled} horizon(s) across ${mints.length} mint(s)`);

  // Surface the current calibration so you can watch the feedback loop fill in.
  const cal = await store.getScoringCalibration();
  log(
    `calibration: ${cal.totalClassified} classified, ` +
      `strongRugRate=${cal.strongRugRate == null ? "n/a" : Math.round(cal.strongRugRate * 100) + "%"}, ` +
      `insiderRugMult=${cal.insiderRugMultiplier == null ? "n/a" : cal.insiderRugMultiplier.toFixed(1) + "x"}`,
  );
}

function cleanup() {
  rmSync(outDir, { recursive: true, force: true });
}

if (ONCE) {
  try {
    await reconcileOnce();
  } catch (e) {
    log("reconcile error:", e?.message ?? e);
  } finally {
    cleanup();
  }
  process.exit(0);
}

// Serialize passes so a slow Jupiter fetch never overlaps the next tick on the
// store's atomic write.
let chain = Promise.resolve();
function serialize(fn) {
  chain = chain.then(fn, fn);
  return chain;
}

log(`running. Reconciling every ${TICK_MS}ms. Ctrl+C to stop.`);
await serialize(() => reconcileOnce().catch((e) => log("reconcile error:", e?.message ?? e)));
const timer = setInterval(() => {
  serialize(() => reconcileOnce().catch((e) => log("reconcile error:", e?.message ?? e)));
}, TICK_MS);

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  cleanup();
  log("stopped.");
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
