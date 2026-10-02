// Wallet / signer for automated trading. SERVER-ONLY. The secret key is read
// from env (never a request body, never serialized into a response). In dry-run
// the keypair may be absent and no signing path is ever reached.
//
// The guard functions are pure and chain-free so they can be unit-tested without
// a network. They throw a GuardError on violation; callers treat that as "do not
// trade" rather than a crash.

import { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import bs58 from "bs58";
import { getTradeConfig, type TradeConfig } from "./trade-config";

export class GuardError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "GuardError";
  }
}

// Parse TRADE_WALLET_SECRET_KEY: either base58 (Phantom export) or a JSON byte
// array like "[12,34,...]". Returns null when unset (forces dry-run upstream).
// Never logs or echoes the secret.
export function loadKeypair(cfg: TradeConfig = getTradeConfig()): Keypair | null {
  const raw = cfg.walletSecretKey;
  if (!raw) return null;
  try {
    const trimmed = raw.trim();
    let bytes: Uint8Array;
    if (trimmed.startsWith("[")) {
      const arr = JSON.parse(trimmed) as number[];
      if (!Array.isArray(arr) || arr.some((n) => typeof n !== "number")) {
        throw new Error("not a numeric array");
      }
      bytes = Uint8Array.from(arr);
    } else {
      bytes = bs58.decode(trimmed);
    }
    if (bytes.length !== 64) {
      throw new Error(`expected 64-byte secret key, got ${bytes.length}`);
    }
    return Keypair.fromSecretKey(bytes);
  } catch (e) {
    // Deliberately do NOT include the raw value in the message.
    throw new GuardError(
      `Invalid TRADE_WALLET_SECRET_KEY: ${e instanceof Error ? e.message : "parse failed"}`,
      "bad-secret-key",
    );
  }
}

export function getConnection(cfg: TradeConfig = getTradeConfig()): Connection {
  return new Connection(cfg.rpcUrl, "confirmed");
}

export async function getBalanceSol(
  conn: Connection,
  pubkey: PublicKey,
): Promise<number> {
  const lamports = await conn.getBalance(pubkey);
  return lamports / LAMPORTS_PER_SOL;
}

// Actual on-chain balance of `mint` held by `owner`, in UI units (summed across
// token accounts). Returns 0 when the owner holds none. Used to reconcile the
// ledger after an ambiguous ("unknown") send, where we can't tell from the tx
// alone whether a sell executed.
export async function getTokenBalance(
  conn: Connection,
  owner: PublicKey,
  mint: string,
): Promise<number> {
  const { value } = await conn.getParsedTokenAccountsByOwner(owner, {
    mint: new PublicKey(mint),
  });
  let total = 0;
  for (const { account } of value) {
    const parsed = account.data as unknown as {
      parsed?: { info?: { tokenAmount?: { uiAmount?: number | null } } };
    };
    total += parsed.parsed?.info?.tokenAmount?.uiAmount ?? 0;
  }
  return total;
}

// ── Pure guards (no chain) ─────────────────────────────────────────────

export function assertKillSwitchOff(cfg: TradeConfig = getTradeConfig()): void {
  if (cfg.killSwitch) {
    throw new GuardError("Kill-switch is ON — trading halted", "kill-switch");
  }
}

export function assertUnderMaxSol(
  amountSol: number,
  cfg: TradeConfig = getTradeConfig(),
): void {
  if (!(amountSol > 0)) {
    throw new GuardError(`Trade amount must be positive (got ${amountSol})`, "nonpositive-amount");
  }
  if (amountSol > cfg.maxSolPerTrade) {
    throw new GuardError(
      `Trade ${amountSol} SOL exceeds per-trade cap ${cfg.maxSolPerTrade}`,
      "max-sol-per-trade",
    );
  }
}

export function assertDailyCapOk(
  tradesOpenedToday: number,
  cfg: TradeConfig = getTradeConfig(),
): void {
  if (tradesOpenedToday >= cfg.maxTradesPerDay) {
    throw new GuardError(
      `Daily trade cap reached (${tradesOpenedToday}/${cfg.maxTradesPerDay})`,
      "daily-cap",
    );
  }
}

// A buy must leave at least minWalletSol in the wallet after spending amountSol.
export function assertBalanceFloorOk(
  balanceSol: number,
  amountSol: number,
  cfg: TradeConfig = getTradeConfig(),
): void {
  if (balanceSol - amountSol < cfg.minWalletSol) {
    throw new GuardError(
      `Buy ${amountSol} SOL would drop balance ${balanceSol} below floor ${cfg.minWalletSol}`,
      "balance-floor",
    );
  }
}

// A buy must be small relative to pool liquidity (thin-pool guard). poolLiquidityUsd
// may be null when no source reported it — then we refuse (fail closed).
export function assertPoolDepthOk(
  tradeUsd: number,
  poolLiquidityUsd: number | null,
  cfg: TradeConfig = getTradeConfig(),
): void {
  if (poolLiquidityUsd == null || !(poolLiquidityUsd > 0)) {
    throw new GuardError("No liquidity data for token — refusing entry", "no-liquidity-data");
  }
  const share = tradeUsd / poolLiquidityUsd;
  if (share > cfg.maxPoolShare) {
    throw new GuardError(
      `Trade is ${(share * 100).toFixed(2)}% of pool (max ${(cfg.maxPoolShare * 100).toFixed(2)}%) — pool too thin`,
      "pool-too-thin",
    );
  }
}

// Reject a Jupiter quote whose price impact is too high.
export function assertPriceImpactOk(
  priceImpactPct: number | null,
  cfg: TradeConfig = getTradeConfig(),
): void {
  if (priceImpactPct == null) return; // unknown impact isn't itself a violation
  if (priceImpactPct > cfg.maxPriceImpactPct) {
    throw new GuardError(
      `Price impact ${priceImpactPct.toFixed(2)}% exceeds cap ${cfg.maxPriceImpactPct}%`,
      "price-impact",
    );
  }
}
