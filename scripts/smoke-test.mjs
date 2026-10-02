// Standalone live smoke test for the Flux RPC + RugCheck integrations.
// Loads .env.local, then calls the real APIs. Run: node scripts/smoke-test.mjs
// It does not import the TS lib (that needs a build); it reimplements the
// minimal calls so we can verify keys + upstream reachability end-to-end.

import { readFileSync } from "node:fs";

// --- tiny .env.local loader (no dependency) ---
try {
  const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  console.error("Could not read .env.local");
  process.exit(1);
}

const FLUX_URL = process.env.FLUX_RPC_URL;
const FLUX_KEY = process.env.FLUX_RPC_API_KEY;
const RUGCHECK_KEY = process.env.RUGCHECK_API_KEY;

// BONK — a real, liquid Solana mint; safe to query on public endpoints.
const MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const pass = (m) => console.log(`  \x1b[32mPASS\x1b[0m ${m}`);
const fail = (m) => console.log(`  \x1b[31mFAIL\x1b[0m ${m}`);

function fluxEndpoint() {
  const url = new URL(FLUX_URL);
  url.searchParams.set("key", FLUX_KEY);
  return url.toString();
}

async function fluxRpc(method, params = []) {
  const res = await fetch(fluxEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.error) throw new Error(`RPC ${json.error.code}: ${json.error.message}`);
  return json.result;
}

async function testFlux() {
  console.log("\n[1] Flux RPC");
  if (!FLUX_URL || !FLUX_KEY) return fail("FLUX_RPC_URL / FLUX_RPC_API_KEY not set");
  try {
    const health = await fluxRpc("getHealth");
    health === "ok" ? pass(`getHealth -> ${health}`) : fail(`getHealth -> ${health}`);
  } catch (e) { return fail(`getHealth: ${e.message}`); }
  try {
    const v = await fluxRpc("getVersion");
    pass(`getVersion -> solana-core ${v["solana-core"]}`);
  } catch (e) { fail(`getVersion: ${e.message}`); }
  try {
    const sup = await fluxRpc("getTokenSupply", [MINT]);
    pass(`getTokenSupply(BONK) -> ${sup.value.uiAmountString ?? sup.value.amount} (decimals ${sup.value.decimals})`);
  } catch (e) { fail(`getTokenSupply: ${e.message}`); }
  try {
    const largest = await fluxRpc("getTokenLargestAccounts", [MINT]);
    pass(`getTokenLargestAccounts(BONK) -> ${largest.value.length} accounts`);
  } catch (e) { fail(`getTokenLargestAccounts: ${e.message}`); }
  try {
    const info = await fluxRpc("getAccountInfo", [MINT, { encoding: "jsonParsed" }]);
    const p = info.value?.data?.parsed?.info;
    pass(`getAccountInfo(BONK) -> mintAuth ${p?.mintAuthority === null ? "revoked" : "set"}, freezeAuth ${p?.freezeAuthority === null ? "revoked" : "set"}`);
  } catch (e) { fail(`getAccountInfo: ${e.message}`); }
}

async function testRugcheck() {
  console.log("\n[2] RugCheck API");
  // Public endpoint (no key)
  try {
    const res = await fetch("https://api.rugcheck.xyz/v1/search?q=bonk&limit=3", {
      headers: { accept: "application/json" },
    });
    if (!res.ok) fail(`search HTTP ${res.status}`);
    else {
      const j = await res.json();
      pass(`search("bonk") -> ${Array.isArray(j) ? j.length : "?"} results (public, no key)`);
    }
  } catch (e) { fail(`search: ${e.message}`); }

  // Summary (public)
  try {
    const res = await fetch(`https://api.rugcheck.xyz/v1/tokens/${MINT}/report/summary`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) fail(`summary HTTP ${res.status}`);
    else {
      const j = await res.json();
      pass(`report/summary(BONK) -> score_normalised ${j.score_normalised}, ${(j.risks ?? []).length} risks`);
    }
  } catch (e) { fail(`summary: ${e.message}`); }

  // Key-gated endpoint: full report
  console.log(`  (using RUGCHECK_API_KEY ${RUGCHECK_KEY ? "set" : "MISSING"})`);
  try {
    const res = await fetch(`https://api.rugcheck.xyz/v1/tokens/${MINT}/report`, {
      headers: { accept: "application/json", "X-API-KEY": RUGCHECK_KEY ?? "" },
    });
    if (!res.ok) fail(`report HTTP ${res.status} (key may be invalid/expired)`);
    else {
      const j = await res.json();
      pass(`tokens/{mint}/report(BONK) -> liquidity $${j.totalMarketLiquidity ?? "?"}, ${(j.topHolders ?? []).length} holders`);
    }
  } catch (e) { fail(`report: ${e.message}`); }

  // Bulk report (key-gated, POST) — this is what /api/solana-gems uses
  try {
    const res = await fetch("https://api.rugcheck.xyz/v1/bulk/tokens/report", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": RUGCHECK_KEY ?? "" },
      body: JSON.stringify({ tokens: [MINT] }),
    });
    if (!res.ok) fail(`bulk report HTTP ${res.status}`);
    else {
      const j = await res.json();
      const n = Array.isArray(j) ? j.length : Object.keys(j ?? {}).length;
      pass(`bulk/tokens/report -> ${n} entr${n === 1 ? "y" : "ies"}`);
    }
  } catch (e) { fail(`bulk report: ${e.message}`); }

  // Stats feed (public)
  try {
    const res = await fetch("https://api.rugcheck.xyz/v1/stats/new_tokens", {
      headers: { accept: "application/json" },
    });
    if (!res.ok) fail(`stats/new_tokens HTTP ${res.status}`);
    else {
      const j = await res.json();
      pass(`stats/new_tokens -> ${Array.isArray(j) ? j.length : "?"} tokens`);
    }
  } catch (e) { fail(`stats/new_tokens: ${e.message}`); }
}

async function testSocket() {
  console.log("\n[3] RugCheck Socket (WebSocket)");
  console.log("  \x1b[33mSKIP\x1b[0m no WebSocket code found in src/ — documented in phase docs but not yet implemented");
}

console.log("AlphaHunter integration smoke test");
console.log("mint under test: BONK", MINT);
await testFlux();
await testRugcheck();
await testSocket();
console.log("\ndone.");
