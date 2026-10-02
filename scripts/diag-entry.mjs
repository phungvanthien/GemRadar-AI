// Diagnostic: run maybeEnterPositions over the last scan's gems and print every
// decision + reason. Forces DRY-RUN (TRADE_MODE unset) so nothing is signed.
//
// Run: node scripts/diag-entry.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Hard-force dry-run for safety during diagnosis.
delete process.env.TRADE_MODE;
delete process.env.TRADE_WALLET_SECRET_KEY;

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = mkdtempSync(join(root, "node_modules", ".diag-entry-"));

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

execFileSync(
  join(root, "node_modules/.bin/tsc"),
  ["src/lib/trade-entry.ts", "--outDir", outDir, "--module", "esnext",
   "--target", "es2022", "--moduleResolution", "bundler", "--skipLibCheck", "--esModuleInterop"],
  { cwd: root, stdio: "inherit" },
);
addJsExtensions(outDir);

const { maybeEnterPositions } = await import(pathToFileURL(join(outDir, "trade-entry.js")).href);

const scan = JSON.parse(readFileSync("/tmp/scan-fixed.json", "utf8"));
const scored = scan.gems;

const decisions = await maybeEnterPositions(scored);
const rows = decisions
  .map((d) => ({ symbol: d.symbol, action: d.action, mode: d.mode, reason: d.reason }))
  .sort((a, b) => (a.action === "bought" ? -1 : 1));
console.table(rows);

rmSync(outDir, { recursive: true, force: true });
process.chdir(root);
