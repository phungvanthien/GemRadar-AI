// Tool definitions + executor for the chat agent. These let the model pull live
// data on demand instead of answering purely from its training knowledge:
//
//   search_tokens        — find Solana tokens by name/symbol (RugCheck search)
//   scan_token           — full on-chain + RugCheck + Jupiter snapshot for a mint
//   get_market_overview  — BTC dominance, fear/greed, top movers (CoinGecko)
//
// Each executor degrades to a structured error object rather than throwing, so a
// single failing tool never breaks the whole chat turn. The schema is OpenAI's
// function-calling format, which FridayAIX (OpenAI-compatible) also accepts.

import type OpenAI from "openai";
import { searchRugcheckTokens, getRugcheckReport } from "./rugcheck";
import { enrichWithOnChain } from "./flux-solana";
import { getJupiterPrices } from "./jupiter";
import {
  fetchFearGreed,
  fetchGlobalMetrics,
  fetchListings,
  getTopMovers,
  getTrending,
} from "./coingecko";
import type { SolanaRugcheckSignal } from "./types";

// Base58 Solana mint (excludes 0, O, I, l), 32-44 chars.
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const CHAT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_tokens",
      description:
        "Search for Solana SPL tokens by name or symbol. Returns matching mints with their RugCheck risk score. Use this to resolve a token the user names (e.g. 'BONK') into a mint address before scanning it. An empty query returns currently trending tokens.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Token name or symbol to search for. Empty string returns trending tokens.",
          },
          limit: {
            type: "number",
            description: "Max results to return (1-20). Defaults to 10.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "scan_token",
      description:
        "Fetch a full safety + market snapshot for one Solana token by its mint address: on-chain authorities, holder concentration, token age, RugCheck risk score and flags, LP lock, insider networks, and live price/liquidity/24h change from Jupiter. Use this whenever the user asks about a specific token's safety, risk, or whether it's a gem. If you only have a name/symbol, call search_tokens first to get the mint.",
      parameters: {
        type: "object",
        properties: {
          mint: {
            type: "string",
            description: "The Solana mint (base58, 32-44 chars) to analyze.",
          },
        },
        required: ["mint"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_market_overview",
      description:
        "Get the current crypto market snapshot: BTC dominance, total market cap, the Fear & Greed index, and the top gaining/losing/trending coins. Use this when the user asks about overall market conditions, sentiment, or what's moving today.",
      parameters: { type: "object", properties: {} },
    },
  },
];

// ---- Executors -------------------------------------------------------------

async function execSearchTokens(args: { query?: string; limit?: number }) {
  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 20);
  const results = await searchRugcheckTokens(args.query ?? "", limit);
  return {
    count: results.length,
    tokens: results.map((r) => ({
      mint: r.mint,
      name: r.name,
      symbol: r.symbol,
      rugcheckRisk: r.scoreNormalised, // 0-100, higher = riskier
    })),
  };
}

async function execScanToken(args: { mint?: string }) {
  const mint = (args.mint ?? "").trim();
  if (!MINT_RE.test(mint)) {
    return { error: `Invalid Solana mint address: ${mint || "(missing)"}` };
  }

  // RugCheck report + Jupiter price run in parallel; both degrade to null.
  const [report, jupiterMap] = await Promise.all([
    getRugcheckReport(mint),
    getJupiterPrices([mint]),
  ]);

  const rugcheck: SolanaRugcheckSignal | null = report
    ? {
        scoreNormalised: report.scoreNormalised,
        topRisks: report.risks
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
          .map((r) => r.name),
        lpLockedPct: report.lpLockedPct,
        insiderNetworkCount: report.insiderNetworks.length,
        totalMarketLiquidity: report.totalMarketLiquidity,
      }
    : null;

  // On-chain enrichment can throw (bad mint, RPC outage) — surface as an error
  // object rather than failing the whole chat turn.
  let onChain;
  try {
    onChain = await enrichWithOnChain(mint, undefined, rugcheck);
  } catch (e) {
    return {
      error: `On-chain lookup failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const jup = jupiterMap.get(mint);
  const ageHours = onChain.ageSeconds != null ? onChain.ageSeconds / 3600 : null;

  return {
    mint,
    onChain: {
      mintAuthorityRevoked: onChain.mintAuthorityRevoked,
      freezeAuthorityRevoked: onChain.freezeAuthorityRevoked,
      top10HolderShare: Number(onChain.holderConcentrationTop10.toFixed(4)),
      largestHolderShare: Number(onChain.largestHolderShare.toFixed(4)),
      holderCount: onChain.holderCount,
      ageHours: ageHours != null ? Number(ageHours.toFixed(1)) : null,
      supply: onChain.supply,
    },
    rugcheck,
    market: jup
      ? {
          usdPrice: jup.usdPrice,
          liquidityUsd: jup.liquidity,
          priceChange24h: jup.priceChange24h,
        }
      : null,
  };
}

async function execMarketOverview() {
  const [listings, global, fearGreed] = await Promise.all([
    fetchListings(200),
    fetchGlobalMetrics(),
    fetchFearGreed(),
  ]);
  const { gainers, losers } = getTopMovers(listings, 5);
  const trending = getTrending(listings, 8);
  const slim = (t: { symbol: string; name: string; percentChange24h: number }) => ({
    symbol: t.symbol,
    name: t.name,
    change24h: Number(t.percentChange24h.toFixed(2)),
  });

  return {
    btcDominance: Number(global.btcDominance.toFixed(2)),
    totalMarketCap: global.totalMarketCap,
    fearGreedIndex: fearGreed.value,
    fearGreedLabel: fearGreed.label,
    topGainers: gainers.map(slim),
    topLosers: losers.map(slim),
    trending: trending.map(slim),
  };
}

// Run a tool call by name. Always resolves (never throws): on an unknown tool or
// a bad-JSON argument string it returns a structured error the model can read.
export async function runTool(name: string, rawArgs: string): Promise<unknown> {
  let args: Record<string, unknown> = {};
  if (rawArgs && rawArgs.trim()) {
    try {
      args = JSON.parse(rawArgs);
    } catch {
      return { error: `Could not parse arguments for ${name}: ${rawArgs}` };
    }
  }

  try {
    switch (name) {
      case "search_tokens":
        return await execSearchTokens(args as { query?: string; limit?: number });
      case "scan_token":
        return await execScanToken(args as { mint?: string });
      case "get_market_overview":
        return await execMarketOverview();
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
