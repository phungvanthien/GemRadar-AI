// Solana on-chain enrichment via Flux RPC.
// See flux-integration-plan.md (Giai đoạn 2–5). Builds the safety/liquidity
// signals that CoinMarketCap does not expose: holder concentration, revoked
// authorities, and token age.

import { fluxRpc } from "./flux";
import type {
  SolanaOnChainMetrics,
  SolanaPoolLiquidity,
  SolanaRugcheckSignal,
} from "./types";

interface TokenAmount {
  amount: string; // raw integer as string
  decimals: number;
  uiAmount: number | null;
}

interface RpcValue<T> {
  context: { slot: number };
  value: T;
}

// Total supply of an SPL mint.
async function getSupply(mint: string): Promise<{ supply: number; decimals: number }> {
  const res = await fluxRpc<RpcValue<TokenAmount>>("getTokenSupply", [mint]);
  const { amount, decimals } = res.value;
  return { supply: Number(amount) / 10 ** decimals, decimals };
}

// The 20 largest token accounts. Used to measure concentration (rug indicator).
async function getLargestAccounts(mint: string): Promise<TokenAmount[]> {
  const res = await fluxRpc<RpcValue<TokenAmount[]>>("getTokenLargestAccounts", [mint]);
  return res.value;
}

interface ParsedMintAccount {
  data: {
    parsed: {
      info: {
        mintAuthority: string | null;
        freezeAuthority: string | null;
        decimals: number;
        supply: string;
      };
    };
    program: string;
  } | [string, string];
}

// Mint account authorities. Revoked (null) authorities are a safety signal —
// mintAuthority still set = supply can be inflated, freezeAuthority set = honeypot risk.
async function getMintAuthorities(mint: string): Promise<{
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
}> {
  const res = await fluxRpc<RpcValue<ParsedMintAccount | null>>("getAccountInfo", [
    mint,
    { encoding: "jsonParsed" },
  ]);

  const data = res.value?.data;
  if (!data || Array.isArray(data) || !("parsed" in data)) {
    // Non-parseable (not an SPL mint, or raw encoding) — treat as unknown/not revoked.
    return { mintAuthorityRevoked: false, freezeAuthorityRevoked: false };
  }

  const info = data.parsed.info;
  return {
    mintAuthorityRevoked: info.mintAuthority === null,
    freezeAuthorityRevoked: info.freezeAuthority === null,
  };
}

// Number of non-empty token accounts for a mint — a proxy for holder count.
// A rising holder count is a healthy-distribution signal; a very low count
// means supply is concentrated in a handful of wallets (rug risk). Returns
// null if the node doesn't support the method (it's a Flux extension).
async function getHolderCount(mint: string): Promise<number | null> {
  try {
    return await fluxRpc<number>("getTokenAccountsCount", [mint, { excludeZero: true }]);
  } catch {
    return null;
  }
}

interface SignatureInfo {
  signature: string;
  slot: number;
  blockTime: number | null;
}

// Age of the mint from its oldest known signature. getSignaturesForAddress returns
// newest-first, so we page to the tail to find the earliest transaction.
async function getAgeSeconds(mint: string): Promise<number | null> {
  let before: string | undefined;
  let oldest: SignatureInfo | undefined;

  // Cap pagination so a hot mint with huge history doesn't stall the request.
  for (let page = 0; page < 5; page++) {
    const params: unknown[] = [mint, before ? { limit: 1000, before } : { limit: 1000 }];
    const sigs = await fluxRpc<SignatureInfo[]>("getSignaturesForAddress", params);
    if (sigs.length === 0) break;
    oldest = sigs[sigs.length - 1];
    if (sigs.length < 1000) break;
    before = oldest.signature;
  }

  if (!oldest) return null;

  const blockTime =
    oldest.blockTime ??
    (await fluxRpc<number | null>("getBlockTime", [oldest.slot]).catch(() => null));
  if (blockTime === null) return null;

  return Math.max(0, Math.floor(Date.now() / 1000) - blockTime);
}

// A pool's base + quote token vaults. Caller supplies the two SPL token-account
// addresses (and an optional label for the quote asset).
export interface PoolVaults {
  baseVault: string;
  quoteVault: string;
  quoteSymbol?: string;
}

interface ParsedTokenAccount {
  data: {
    parsed: { info: { tokenAmount: TokenAmount } };
    program: string;
  } | [string, string];
}

// Read both pool vault balances in a single getMultipleAccounts call. Returns
// null if either vault is missing or not a parseable SPL token account.
async function getPoolLiquidity(vaults: PoolVaults): Promise<SolanaPoolLiquidity | null> {
  const res = await fluxRpc<RpcValue<(ParsedTokenAccount | null)[]>>("getMultipleAccounts", [
    [vaults.baseVault, vaults.quoteVault],
    { encoding: "jsonParsed" },
  ]);

  const amount = (acc: ParsedTokenAccount | null): number | null => {
    const data = acc?.data;
    if (!data || Array.isArray(data) || !("parsed" in data)) return null;
    const t = data.parsed.info.tokenAmount;
    return t.uiAmount ?? Number(t.amount) / 10 ** t.decimals;
  };

  const base = amount(res.value[0]);
  const quote = amount(res.value[1]);
  if (base === null || quote === null) return null;

  return { baseAmount: base, quoteAmount: quote, quoteSymbol: vaults.quoteSymbol ?? "quote" };
}

// Aggregate all on-chain signals for a single mint. Runs the independent calls
// in parallel to keep latency low when scanning several tokens. Pool vaults are
// optional — pass them to also measure real liquidity (TVL).
export async function enrichWithOnChain(
  mint: string,
  vaults?: PoolVaults,
  rugcheck?: SolanaRugcheckSignal | null,
): Promise<SolanaOnChainMetrics> {
  const [supplyRes, largest, authorities, ageSeconds, holderCount, liquidity] = await Promise.all([
    getSupply(mint),
    getLargestAccounts(mint),
    getMintAuthorities(mint),
    getAgeSeconds(mint),
    getHolderCount(mint),
    vaults ? getPoolLiquidity(vaults) : Promise.resolve(null),
  ]);

  const { supply, decimals } = supplyRes;
  const holderAmounts = largest.map((a) => Number(a.amount) / 10 ** a.decimals);
  const top10 = holderAmounts.slice(0, 10).reduce((sum, n) => sum + n, 0);
  const largestShare = holderAmounts.length > 0 ? holderAmounts[0] : 0;

  return {
    mint,
    decimals,
    supply,
    holderConcentrationTop10: supply > 0 ? top10 / supply : 0,
    largestHolderShare: supply > 0 ? largestShare / supply : 0,
    holderCount,
    mintAuthorityRevoked: authorities.mintAuthorityRevoked,
    freezeAuthorityRevoked: authorities.freezeAuthorityRevoked,
    ageSeconds,
    liquidity,
    rugcheck: rugcheck ?? null,
  };
}
