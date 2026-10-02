// Read-only wallet balance check. Loads the trade wallet from env, prints the
// PUBLIC key + SOL balance from the configured RPC. Never prints the secret.
//
// Run: node scripts/check-wallet.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import bs58 from "bs58";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Minimal .env.local loader (no dotenv dependency).
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
    // no .env.local — fall back to process env
  }
}

function loadKeypair(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  let bytes;
  if (trimmed.startsWith("[")) {
    bytes = Uint8Array.from(JSON.parse(trimmed));
  } else {
    bytes = bs58.decode(trimmed);
  }
  if (bytes.length !== 64) throw new Error(`expected 64-byte key, got ${bytes.length}`);
  return Keypair.fromSecretKey(bytes);
}

loadEnv();

const rpcUrl = process.env.SOLANA_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com";
const mode = (process.env.TRADE_MODE?.trim().toLowerCase() === "live") ? "live" : "dry-run";
const killSwitch = ["true", "1", "yes"].includes(process.env.TRADE_KILL_SWITCH?.trim().toLowerCase());
const minWalletSol = Number(process.env.TRADE_MIN_WALLET_SOL || 0.05);
const maxSolPerTrade = Number(process.env.TRADE_MAX_SOL_PER_TRADE || 0.25);

const kp = loadKeypair(process.env.TRADE_WALLET_SECRET_KEY);
if (!kp) {
  console.error("❌ TRADE_WALLET_SECRET_KEY not set — cannot check balance.");
  process.exit(1);
}

const pubkey = kp.publicKey;
console.log("── Wallet check ──────────────────────────────");
console.log(`RPC:        ${rpcUrl}`);
console.log(`Public key: ${pubkey.toBase58()}`);

const conn = new Connection(rpcUrl, "confirmed");
const lamports = await conn.getBalance(pubkey);
const sol = lamports / LAMPORTS_PER_SOL;

console.log(`Balance:    ${sol} SOL`);
console.log("── Trade config ──────────────────────────────");
console.log(`TRADE_MODE:            ${mode}`);
console.log(`TRADE_KILL_SWITCH:     ${killSwitch}`);
console.log(`Max SOL per trade:     ${maxSolPerTrade}`);
console.log(`Min wallet floor:      ${minWalletSol}`);
console.log("──────────────────────────────────────────────");

if (sol < minWalletSol) {
  console.log(`⚠️  Balance ${sol} is BELOW the min floor ${minWalletSol} — buys will be rejected.`);
} else {
  const buyable = sol - minWalletSol;
  console.log(`✅ Spendable above floor: ${buyable.toFixed(4)} SOL`);
}
if (mode === "live" && !killSwitch) {
  console.log("🔴 LIVE mode, kill-switch OFF — real funds will move.");
}
