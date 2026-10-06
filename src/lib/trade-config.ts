// Trade-execution config. These are OPERATIONAL SECRETS/FLAGS and live in env
// ONLY — never in alphahunter-settings.json (which the settings panel writes
// from the client). Server-only; the keypair secret must never reach the client.
//
// The single dry-run/live decision lives here: canTradeLive is true ONLY when
// every guard aligns. Any missing piece forces dry-run. Phases 0-5 are built and
// verified entirely in dry-run; flipping to live is a deliberate, separate step.

export type TradeMode = "dry-run" | "live";

export interface TradeConfig {
  mode: TradeMode; // raw TRADE_MODE env, defaults to "dry-run"
  rpcUrl: string;
  // Present only server-side; never serialized into a response.
  walletSecretKey: string | null;
  maxSolPerTrade: number;
  maxTradesPerDay: number;
  minWalletSol: number;
  slippageBps: number;
  // Hard ceiling on Jupiter quote priceImpactPct; a quote above this is rejected.
  maxPriceImpactPct: number;
  // Entry liquidity guard: a buy must be at most this fraction of pool liquidity.
  maxPoolShare: number;
  killSwitch: boolean;
  // The ONE gate. Real funds move only when this is true. Depends on autoBuyEnabled
  // from settings, so it's resolved by canTradeLive(settings), not stored here.

  // ── Token-safety entry gate (POST-MORTEM P0) ───────────────────────────
  // Hunting pump.fun memes with no token-level filter is how CATGPT rugged for
  // -100% and SIP sold at -99.5%. These knobs drive src/lib/token-safety.ts.
  // Minimum USD market liquidity for an entry — below this, stop-loss can't fill
  // and a rug drains the pool instantly. 0 disables the floor (fail-open).
  minLiquidityUsd: number;
  // Reject when the single largest holder exceeds this share of supply (0-1).
  maxTopHolderShare: number;
  // Reject when the top-10 holders exceed this share of supply (0-1).
  maxTop10Share: number;
  // Minimum token age in seconds; a few minutes of survival filters snipe-rugs.
  minTokenAgeSeconds: number;
  // Minimum distinct holder count. 0 disables (null holder data fails open).
  minHolderCount: number;
  // Reject when the computed rug-risk score (0-100) reaches this threshold.
  maxRugRiskScore: number;
}

const DEFAULTS = {
  rpcUrl: "https://api.mainnet-beta.solana.com",
  maxSolPerTrade: 0.25,
  maxTradesPerDay: 10,
  minWalletSol: 0.05,
  slippageBps: 100, // 1%
  maxPriceImpactPct: 3, // reject quotes with >3% price impact
  maxPoolShare: 0.02, // buy must be <=2% of pool liquidity
  minLiquidityUsd: 20_000, // post-mortem floor: below this stop-loss can't fill
  maxTopHolderShare: 0.3, // single holder > 30% of supply -> reject
  maxTop10Share: 0.6, // top-10 > 60% of supply -> reject
  minTokenAgeSeconds: 300, // 5 min survival filters most snipe-and-rug launches
  minHolderCount: 50, // too few holders -> illiquid / insider-held
  maxRugRiskScore: 60, // reject when graded rug risk reaches this
};

function envNum(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (raw == null || raw === "") return fallback;
  return raw === "true" || raw === "1" || raw === "yes";
}

let cached: TradeConfig | null = null;

export function getTradeConfig(): TradeConfig {
  if (cached) return cached;

  const rawMode = process.env.TRADE_MODE?.trim().toLowerCase();
  const mode: TradeMode = rawMode === "live" ? "live" : "dry-run";

  cached = Object.freeze({
    mode,
    rpcUrl: process.env.SOLANA_RPC_URL?.trim() || DEFAULTS.rpcUrl,
    walletSecretKey: process.env.TRADE_WALLET_SECRET_KEY?.trim() || null,
    maxSolPerTrade: envNum("TRADE_MAX_SOL_PER_TRADE", DEFAULTS.maxSolPerTrade),
    maxTradesPerDay: envNum("TRADE_MAX_TRADES_PER_DAY", DEFAULTS.maxTradesPerDay),
    minWalletSol: envNum("TRADE_MIN_WALLET_SOL", DEFAULTS.minWalletSol),
    slippageBps: envNum("TRADE_SLIPPAGE_BPS", DEFAULTS.slippageBps),
    maxPriceImpactPct: envNum("TRADE_MAX_PRICE_IMPACT_PCT", DEFAULTS.maxPriceImpactPct),
    maxPoolShare: envNum("TRADE_MAX_POOL_SHARE", DEFAULTS.maxPoolShare),
    killSwitch: envBool("TRADE_KILL_SWITCH", false),
    minLiquidityUsd: envNum("TRADE_MIN_LIQUIDITY_USD", DEFAULTS.minLiquidityUsd),
    maxTopHolderShare: envNum("TRADE_MAX_TOP_HOLDER_SHARE", DEFAULTS.maxTopHolderShare),
    maxTop10Share: envNum("TRADE_MAX_TOP10_SHARE", DEFAULTS.maxTop10Share),
    minTokenAgeSeconds: envNum("TRADE_MIN_TOKEN_AGE_SECONDS", DEFAULTS.minTokenAgeSeconds),
    minHolderCount: envNum("TRADE_MIN_HOLDER_COUNT", DEFAULTS.minHolderCount),
    maxRugRiskScore: envNum("TRADE_MAX_RUG_RISK_SCORE", DEFAULTS.maxRugRiskScore),
  });
  return cached;
}

// Test-only: drop the cached config so a test can re-read mutated env.
export function resetTradeConfigCache(): void {
  cached = null;
}

// THE SINGLE LIVE-FUNDS GATE. Everything that could move real money must consult
// this. Live requires, together: TRADE_MODE=live AND autoBuyEnabled from settings
// AND a loaded wallet secret AND the kill-switch off. Any missing piece -> dry-run.
export function canTradeLive(opts: { autoBuyEnabled: boolean }): boolean {
  const cfg = getTradeConfig();
  return (
    cfg.mode === "live" &&
    opts.autoBuyEnabled === true &&
    cfg.walletSecretKey != null &&
    cfg.killSwitch === false
  );
}

// The effective mode for a given settings context — what actually happens.
export function effectiveMode(opts: { autoBuyEnabled: boolean }): TradeMode {
  return canTradeLive(opts) ? "live" : "dry-run";
}
