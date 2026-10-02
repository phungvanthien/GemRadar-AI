// Jupiter v6 swap execution. Two paths share one quote step:
//   - DRY-RUN: stop after the quote, log the intended trade, return a synthetic
//     fill with txSig=null, dryRun=true. NO signing, NO network send.
//   - LIVE: only reachable when canTradeLive() is true at the call site. Builds,
//     signs, sends and confirms the versioned transaction.
//
// Jupiter swap is a plain HTTP API — no SDK. @solana/web3.js is used only to
// deserialize/sign/send the transaction Jupiter returns.

import {
  Connection,
  Keypair,
  VersionedTransaction,
} from "@solana/web3.js";
import type { Fill } from "./position-store";
import {
  assertPriceImpactOk,
  GuardError,
} from "./trade-wallet";
import { getTradeConfig, type TradeConfig } from "./trade-config";

// Jupiter retired the quote-api.jup.ag/v6 host; the current free endpoint is
// lite-api.jup.ag/swap/v1 (same request/response shape).
const QUOTE_URL = "https://lite-api.jup.ag/swap/v1/quote";
const SWAP_URL = "https://lite-api.jup.ag/swap/v1/swap";
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const LAMPORTS_PER_SOL = 1_000_000_000;
const QUOTE_TIMEOUT_MS = 10_000;
const CONFIRM_TIMEOUT_MS = 60_000;

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string; // base units of input
  outAmount: string; // base units of output
  priceImpactPct: number | null;
  // Opaque — passed back verbatim to the swap endpoint.
  raw: unknown;
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

async function getQuote(
  inputMint: string,
  outputMint: string,
  amountBaseUnits: string,
  cfg: TradeConfig,
): Promise<JupiterQuote> {
  const url =
    `${QUOTE_URL}?inputMint=${inputMint}&outputMint=${outputMint}` +
    `&amount=${amountBaseUnits}&slippageBps=${cfg.slippageBps}&swapMode=ExactIn`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QUOTE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      throw new GuardError(`Jupiter quote failed: HTTP ${res.status}`, "quote-http");
    }
    const raw = (await res.json()) as Record<string, unknown>;
    if (!raw || typeof raw !== "object" || raw.error) {
      throw new GuardError(
        `Jupiter quote error: ${String(raw?.error ?? "no route")}`,
        "quote-no-route",
      );
    }
    return {
      inputMint,
      outputMint,
      inAmount: String(raw.inAmount ?? amountBaseUnits),
      outAmount: String(raw.outAmount ?? "0"),
      priceImpactPct: num(raw.priceImpactPct),
      raw,
    };
  } finally {
    clearTimeout(timeout);
  }
}

// Outcome of a live send. "confirmed" = landed successfully. "failed" = we have
// positive proof it did NOT execute (on-chain error, or blockhash expired with
// the signature absent) — safe to retry/record as a no-op. "unknown" = we could
// not determine the result (confirm timeout, RPC error after send); the tx MAY
// have landed, so the caller must NOT advance soldPct and must reconcile the
// on-chain balance before acting again.
export type SendOutcome =
  | { status: "confirmed"; sig: string }
  | { status: "failed"; sig: string | null; reason: string }
  | { status: "unknown"; sig: string | null; reason: string };

async function buildSwapTx(
  quote: JupiterQuote,
  keypair: Keypair,
): Promise<{ tx: VersionedTransaction; lastValidBlockHeight: number | null }> {
  const res = await fetch(SWAP_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      quoteResponse: quote.raw,
      userPublicKey: keypair.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new GuardError(`Jupiter swap build failed: HTTP ${res.status}`, "swap-http");
  }
  const body = (await res.json()) as {
    swapTransaction?: string;
    lastValidBlockHeight?: number;
  };
  if (!body.swapTransaction) {
    throw new GuardError("Jupiter swap returned no transaction", "swap-no-tx");
  }
  const tx = VersionedTransaction.deserialize(Buffer.from(body.swapTransaction, "base64"));
  tx.sign([keypair]);
  return { tx, lastValidBlockHeight: body.lastValidBlockHeight ?? null };
}

// Authoritative post-send check: ask the cluster directly whether the signature
// landed. Used when the normal confirm times out, to turn "unknown" into a
// definite confirmed/failed where possible.
async function querySignature(conn: Connection, sig: string): Promise<SendOutcome> {
  try {
    const { value } = await conn.getSignatureStatuses([sig], {
      searchTransactionHistory: true,
    });
    const st = value[0];
    if (!st) return { status: "unknown", sig, reason: "status-null" };
    if (st.err) return { status: "failed", sig, reason: `onchain:${JSON.stringify(st.err)}` };
    if (
      st.confirmationStatus === "confirmed" ||
      st.confirmationStatus === "finalized"
    ) {
      return { status: "confirmed", sig };
    }
    return { status: "unknown", sig, reason: `status:${st.confirmationStatus ?? "processed"}` };
  } catch (e) {
    return { status: "unknown", sig, reason: e instanceof Error ? e.message : "status-query-failed" };
  }
}

// LIVE ONLY. Builds, signs, sends, confirms with a bounded retry on transient
// send failures. Confirms against the TX'S OWN blockhash (read from the signed
// message), not a freshly-fetched one, so expiry is detected correctly. Returns
// a classified SendOutcome rather than throwing for every failure, so the caller
// can distinguish "definitely didn't happen" from "might have happened".
async function executeSwap(
  quote: JupiterQuote,
  keypair: Keypair,
  conn: Connection,
): Promise<SendOutcome> {
  const { tx, lastValidBlockHeight } = await buildSwapTx(quote, keypair);
  const blockhash = tx.message.recentBlockhash;
  const raw = tx.serialize();

  let lastSig: string | null = null;
  const maxSendAttempts = 3;

  for (let attempt = 1; attempt <= maxSendAttempts; attempt++) {
    let sig: string;
    try {
      sig = await conn.sendRawTransaction(raw, {
        skipPreflight: false,
        maxRetries: 0, // we drive retries ourselves so we control classification
      });
      lastSig = sig;
    } catch (e) {
      // A send that errors before returning a signature definitely did not land
      // under that attempt. Transient (blockhash not yet seen, node busy) ->
      // retry; otherwise fail.
      const msg = e instanceof Error ? e.message : "send-failed";
      if (attempt < maxSendAttempts && /blockhash|node is behind|timed out|429|503/i.test(msg)) {
        await sleep(500 * attempt);
        continue;
      }
      return { status: "failed", sig: null, reason: `send:${msg}` };
    }

    // Confirm against the transaction's own blockhash. If Jupiter gave us a
    // lastValidBlockHeight use it; otherwise fetch the current one for the
    // height field (the blockhash itself is the tx's).
    let height = lastValidBlockHeight;
    if (height == null) {
      try {
        height = (await conn.getLatestBlockhash("confirmed")).lastValidBlockHeight;
      } catch {
        height = null;
      }
    }

    try {
      const confirmation = await Promise.race([
        conn.confirmTransaction(
          height != null
            ? { signature: sig, blockhash, lastValidBlockHeight: height }
            : // Fallback form: polls until timeout.
              { signature: sig, blockhash, lastValidBlockHeight: Number.MAX_SAFE_INTEGER },
          "confirmed",
        ),
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), CONFIRM_TIMEOUT_MS)),
      ]);

      if (confirmation === "timeout") {
        // Don't guess — ask the cluster directly.
        return await querySignature(conn, sig);
      }
      if ("value" in confirmation && confirmation.value?.err) {
        return { status: "failed", sig, reason: `onchain:${JSON.stringify(confirmation.value.err)}` };
      }
      return { status: "confirmed", sig };
    } catch (e) {
      // confirmTransaction throws on blockhash expiry (TransactionExpiredBlockheightExceededError).
      // Expiry with no landing => failed; verify via a direct query to be sure.
      const checked = await querySignature(conn, sig);
      if (checked.status !== "unknown") return checked;
      return { status: "unknown", sig, reason: e instanceof Error ? e.message : "confirm-error" };
    }
  }

  return { status: "unknown", sig: lastSig, reason: "exhausted-send-attempts" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface SwapParams {
  // true => real signing/send. Caller MUST pass canTradeLive() here; this module
  // never decides live-ness on its own.
  live: boolean;
  keypair: Keypair | null; // required when live
  connection: Connection | null; // required when live
  cfg?: TradeConfig;
}

export interface SwapResult {
  fill: Fill;
  quote: JupiterQuote;
  // "confirmed" (or dry-run) => the fill is real and may advance ledger state.
  // "failed" => no execution; fill.error is set, ledger must NOT advance.
  // "unknown" => may have executed; fill.error is set, caller must reconcile the
  //   on-chain balance before any further action on this position.
  outcome: SendOutcome["status"] | "dry-run";
}

// Turn a live SendOutcome into the fill flags the ledger relies on. Only a
// "confirmed" outcome yields a clean fill; everything else carries an error so
// recordSellFill / openPosition treat it as non-advancing.
function applyOutcome(fill: Fill, outcome: SendOutcome): Fill {
  if (outcome.status === "confirmed") {
    return { ...fill, txSig: outcome.sig };
  }
  return {
    ...fill,
    txSig: outcome.sig,
    error: `${outcome.status}:${outcome.reason}`,
  };
}

// BUY: spend `sol` SOL to acquire `mint`. outDecimals is needed to turn the
// quote's base-unit outAmount into a token amount for the position ledger.
export async function buy(
  mint: string,
  sol: number,
  priceUsd: number,
  outDecimals: number,
  params: SwapParams,
  now = new Date(),
): Promise<SwapResult> {
  const cfg = params.cfg ?? getTradeConfig();
  const amountLamports = Math.floor(sol * LAMPORTS_PER_SOL).toString();
  const quote = await getQuote(WSOL_MINT, mint, amountLamports, cfg);
  assertPriceImpactOk(quote.priceImpactPct, cfg);

  const tokenAmount = Number(quote.outAmount) / 10 ** outDecimals;

  if (!params.live) {
    console.log(
      `[DRY-RUN] BUY ${sol} SOL -> ~${tokenAmount} ${mint} ` +
        `(impact ${quote.priceImpactPct?.toFixed(3) ?? "?"}%)`,
    );
    return {
      quote,
      outcome: "dry-run",
      fill: {
        time: now.toISOString(),
        kind: "buy",
        pct: 100,
        priceUsd,
        sol,
        tokenAmount,
        txSig: null,
        dryRun: true,
      },
    };
  }

  if (!params.keypair || !params.connection) {
    throw new GuardError("Live swap requires keypair + connection", "missing-signer");
  }
  const outcome = await executeSwap(quote, params.keypair, params.connection);
  const baseFill: Fill = {
    time: now.toISOString(),
    kind: "buy",
    pct: 100,
    priceUsd,
    sol,
    tokenAmount,
    txSig: null,
    dryRun: false,
  };
  return { quote, outcome: outcome.status, fill: applyOutcome(baseFill, outcome) };
}

// SELL: dispose of `tokenAmount` of `mint` back to SOL. `pct` is the % of the
// ORIGINAL position this represents (for the ledger). reason tags the exit.
export async function sell(
  mint: string,
  tokenAmount: number,
  inDecimals: number,
  pct: number,
  priceUsd: number,
  reason: string,
  params: SwapParams,
  now = new Date(),
): Promise<SwapResult> {
  const cfg = params.cfg ?? getTradeConfig();
  const amountBaseUnits = Math.floor(tokenAmount * 10 ** inDecimals).toString();
  const quote = await getQuote(mint, WSOL_MINT, amountBaseUnits, cfg);
  assertPriceImpactOk(quote.priceImpactPct, cfg);

  const solOut = Number(quote.outAmount) / LAMPORTS_PER_SOL;

  if (!params.live) {
    console.log(
      `[DRY-RUN] SELL ${pct}% (${tokenAmount} ${mint}) -> ~${solOut} SOL ` +
        `[${reason}] (impact ${quote.priceImpactPct?.toFixed(3) ?? "?"}%)`,
    );
    return {
      quote,
      outcome: "dry-run",
      fill: {
        time: now.toISOString(),
        kind: "sell",
        pct,
        priceUsd,
        sol: solOut,
        tokenAmount,
        txSig: null,
        dryRun: true,
        reason,
      },
    };
  }

  if (!params.keypair || !params.connection) {
    throw new GuardError("Live swap requires keypair + connection", "missing-signer");
  }
  const outcome = await executeSwap(quote, params.keypair, params.connection);
  const baseFill: Fill = {
    time: now.toISOString(),
    kind: "sell",
    pct,
    priceUsd,
    sol: solOut,
    tokenAmount,
    txSig: null,
    dryRun: false,
    reason,
  };
  return { quote, outcome: outcome.status, fill: applyOutcome(baseFill, outcome) };
}
