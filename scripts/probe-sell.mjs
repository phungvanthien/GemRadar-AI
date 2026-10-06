// Read-only rugpull probe for OPEN live positions. For each open position in the
// ledger it (1) reads the real on-chain token balance and (2) asks Jupiter for a
// SELL quote (token -> SOL) exactly as the exit engine would. This tells you
// whether a stuck position can still be sold (route + acceptable price impact)
// or is genuinely rugpulled (no route / near-total impact).
//
// NEVER signs or sends anything. Run: node scripts/probe-sell.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import {
  Keypair,
  Connection,
  PublicKey,
} from "@solana/web3.js";
import bs58 from "bs58";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const QUOTE_URL = "https://lite-api.jup.ag/swap/v1/quote";
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const LAMPORTS_PER_SOL = 1_000_000_000;

function loadEnv() {
  try {
    const txt = readFileSync(join(root, ".env.local"), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      let [, k, v] = m;
      v = v.trim().replace(/^["']|["']$/g, "");
      if (process.env[k] == null) process.env[k] = v;
    }
  } catch {
    // fall back to process env
  }
}

function loadKeypair(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  let bytes;
  if (trimmed.startsWith("[")) bytes = Uint8Array.from(JSON.parse(trimmed));
  else bytes = bs58.decode(trimmed);
  if (bytes.length !== 64) throw new Error(`expected 64-byte key, got ${bytes.length}`);
  return Keypair.fromSecretKey(bytes);
}

async function getSellQuote(mint, amountBaseUnits, slippageBps) {
  const url =
    `${QUOTE_URL}?inputMint=${mint}&outputMint=${WSOL_MINT}` +
    `&amount=${amountBaseUnits}&slippageBps=${slippageBps}&swapMode=ExactIn`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const raw = await res.json();
    if (!raw || typeof raw !== "object" || raw.error) {
      return { ok: false, reason: String(raw?.error ?? "no route") };
    }
    const solOut = Number(raw.outAmount ?? 0) / LAMPORTS_PER_SOL;
    const impact = raw.priceImpactPct != null ? Number(raw.priceImpactPct) : null;
    return { ok: true, solOut, impact };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "fetch failed" };
  } finally {
    clearTimeout(timeout);
  }
}

// The EXIT ENGINE reads price from Jupiter Price API v3 (NOT the quote endpoint).
// If a mint is missing here, monitorPositions sees price==null and skips it —
// the position never gets a sell decision even though a quote route exists.
async function getJupiterPriceV3(mint) {
  try {
    const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${mint}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const raw = await res.json();
    const entry = raw?.[mint];
    const usd = entry?.usdPrice;
    if (usd == null) return { ok: false, reason: "no usdPrice in response" };
    return { ok: true, usdPrice: Number(usd) };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "fetch failed" };
  }
}

async function getTokenBalance(conn, owner, mint) {
  try {
    const resp = await conn.getParsedTokenAccountsByOwner(owner, {
      mint: new PublicKey(mint),
    });
    let total = 0;
    for (const { account } of resp.value) {
      const amt = account.data?.parsed?.info?.tokenAmount?.uiAmount;
      if (typeof amt === "number") total += amt;
    }
    return total;
  } catch (e) {
    return null; // RPC error
  }
}

loadEnv();

const rpcUrl = process.env.SOLANA_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com";
const slippageBps = Number(process.env.TRADE_SLIPPAGE_BPS || 100);
// Mirror trade-config default (maxPriceImpactPct: 3). The exit guard compares
// Jupiter's RAW priceImpactPct against this number as-is (trade-wallet.ts).
const maxImpactGuard = Number(process.env.TRADE_MAX_PRICE_IMPACT_PCT || 3);

const kp = loadKeypair(process.env.TRADE_WALLET_SECRET_KEY);
if (!kp) {
  console.error("❌ TRADE_WALLET_SECRET_KEY not set — cannot read on-chain balances.");
  process.exit(1);
}
const conn = new Connection(rpcUrl, "confirmed");

// Match the store path the app actually writes (position-store.ts: STORE_PATH).
const STORE_FILE = "gemradar-positions.json";
let ledger;
try {
  ledger = JSON.parse(readFileSync(join(root, STORE_FILE), "utf8"));
} catch (e) {
  console.error(`❌ Could not read ${STORE_FILE}:`, e.message);
  process.exit(1);
}

// --all also probes positions already closed/written-off, so you can verify
// whether a token the UI marked "rugpull" is in fact still in the wallet and
// sellable (the exact false-positive this diagnoses).
const probeAll = process.argv.includes("--all");
const all = Object.values(ledger.positions ?? {});
const open = probeAll ? all : all.filter((p) => p.status === "open");
console.log("── Rugpull probe (read-only) ─────────────────");
console.log(`RPC:            ${rpcUrl}`);
console.log(`Wallet:         ${kp.publicKey.toBase58()}`);
console.log(`Slippage:       ${slippageBps} bps`);
console.log(`Impact guard:   raw priceImpactPct > ${maxImpactGuard} rejects (trade-wallet.ts)`);
console.log(`Positions:      ${open.length}${probeAll ? " (ALL — incl. closed/written-off)" : " (open only; pass --all for closed)"}`);
console.log("──────────────────────────────────────────────");

if (open.length === 0) {
  console.log(probeAll ? "No positions in the ledger." : "No open positions to probe (try --all).");
  process.exit(0);
}

for (const pos of open) {
  const tag = pos.status === "closed" ? ` [closed: ${pos.closedReason ?? "?"}]` : "";
  console.log(`\n▶ ${pos.symbol}  (${pos.mint})${tag}`);
  console.log(`  entry: ${pos.entrySol} SOL @ $${pos.entryPriceUsd}`);
  console.log(`  ledger tokenAmount: ${pos.tokenAmount}`);

  // What the exit engine actually sees for its sell decision.
  const px = await getJupiterPriceV3(pos.mint);
  if (!px.ok) {
    console.log(
      `  🚨 Price API v3: NO PRICE (${px.reason}) — the exit monitor sees price==null ` +
        `and SKIPS this position every tick. It will NEVER decide to sell it.`,
    );
  } else {
    const dropPct = pos.entryPriceUsd > 0
      ? ((px.usdPrice - pos.entryPriceUsd) / pos.entryPriceUsd) * 100
      : 0;
    const slTrigger = pos.sellStrategy.stopLossPercent > 0
      ? pos.entryPriceUsd * (1 - pos.sellStrategy.stopLossPercent / 100)
      : null;
    console.log(
      `  👁  Price API v3 (what exit engine sees): $${px.usdPrice}  ` +
        `(${dropPct >= 0 ? "+" : ""}${dropPct.toFixed(1)}% vs entry)`,
    );
    if (slTrigger != null && px.usdPrice <= slTrigger) {
      console.log(
        `  🎯 Below stop-loss ($${slTrigger.toExponential(3)}) — exit engine WOULD sell on next tick.`,
      );
    }
  }

  const held = await getTokenBalance(conn, kp.publicKey, pos.mint);
  if (held == null) {
    console.log("  on-chain balance: ⚠️  RPC error (could not read)");
  } else {
    console.log(`  on-chain balance:  ${held} tokens`);
    if (held === 0) {
      console.log("  🔴 Wallet holds ZERO of this token — nothing left to sell on-chain.");
      continue;
    }
  }

  // Quote selling what we actually hold (fallback to ledger amount if RPC failed).
  const sellUi = held && held > 0 ? held : pos.tokenAmount;
  const amountBaseUnits = Math.floor(sellUi * 10 ** pos.decimals).toString();
  const q = await getSellQuote(pos.mint, amountBaseUnits, slippageBps);

  if (!q.ok) {
    console.log(`  💀 SELL quote FAILED: ${q.reason}  → looks rugpulled / unsellable`);
    continue;
  }
  const impactStr = q.impact != null ? `${(q.impact * 100).toFixed(2)}%` : "unknown";
  console.log(`  ✅ SELL quote: ~${q.solOut.toFixed(6)} SOL out  (price impact ${impactStr})`);

  const recoverPct = pos.entrySol > 0 ? (q.solOut / pos.entrySol) * 100 : 0;
  console.log(`     would recover ~${recoverPct.toFixed(1)}% of the ${pos.entrySol} SOL entry`);

  // Mirror assertPriceImpactOk exactly: raw priceImpactPct > cfg.maxPriceImpactPct.
  if (q.impact != null && q.impact > maxImpactGuard) {
    console.log(
      `  ⚠️  Raw priceImpactPct ${q.impact} EXCEEDS guard (${maxImpactGuard}) — ` +
        `the exit engine's assertPriceImpactOk would REJECT this sell.`,
    );
  } else if (q.solOut <= 0) {
    console.log("  ⚠️  Quote returns ~0 SOL — effectively unsellable.");
  } else {
    console.log("  🟢 Sellable within guards — the bot should be able to exit this.");
  }
}

console.log("\n──────────────────────────────────────────────");
console.log("Probe complete. No transactions were signed or sent.");
