import OpenAI from "openai";
import type {
  GemAnalysis,
  MarketToken,
  SolanaGemAnalysis,
  SolanaOnChainMetrics,
} from "./types";
import { CHAT_TOOLS, runTool } from "./ai-tools";
import { getScoringCalibration, renderCalibrationPrompt } from "./gem-outcomes-store";

type ChatMessage = { role: "user" | "assistant"; content: string };

type Provider = "fridayaix" | "openai";

function resolveProvider(): Provider {
  const explicit = process.env.AI_PROVIDER?.toLowerCase();
  if (explicit === "openai") return "openai";
  if (explicit === "fridayaix" || explicit === "anthropic") return "fridayaix";

  // Auto-detect from whichever key is present, defaulting to FridayAIX.
  if (process.env.ANTHROPIC_AUTH_TOKEN) return "fridayaix";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "fridayaix";
}

const ANTHROPIC_MODEL = process.env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? "claude-sonnet-4-6";
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o";

// FridayAIX is an OpenAI-compatible gateway (POST /v1/chat/completions,
// choices[].message.content) that serves Claude models — so it's driven with
// the OpenAI SDK, not the Anthropic one, despite the ANTHROPIC_* env names.
function getFridayaixClient(): OpenAI {
  const apiKey = process.env.ANTHROPIC_AUTH_TOKEN;
  if (!apiKey) {
    throw new Error("ANTHROPIC_AUTH_TOKEN is not configured");
  }
  const base = process.env.ANTHROPIC_BASE_URL ?? "https://oneai.fridayaix.com";
  const baseURL = base.replace(/\/+$/, "") + "/v1";
  return new OpenAI({ apiKey, baseURL });
}

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  return new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL,
  });
}

// Prompt caching note: all calls go through the OpenAI Chat Completions API
// (FridayAIX speaks that protocol), where prompt caching is AUTOMATIC — there is
// no param to set, and Anthropic-style cache_control blocks don't apply on this
// path. Caching only kicks in for a shared prefix of ~1024+ tokens, so we keep
// the system prompt first in every call (the stable prefix) to maximize hits if
// a prompt grows past that threshold. Today's prompts are shorter than that, so
// nothing is cached yet; this is expected, not a missing optimization.
async function complete(params: {
  system: string;
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
}): Promise<string> {
  const provider = resolveProvider();
  const client = provider === "openai" ? getOpenAIClient() : getFridayaixClient();
  const model = provider === "openai" ? OPENAI_MODEL : ANTHROPIC_MODEL;

  const response = await client.chat.completions.create({
    model,
    temperature: params.temperature,
    max_tokens: params.maxTokens,
    messages: [
      { role: "system", content: params.system },
      ...params.messages,
    ],
  });
  logUsage("complete", response.usage);
  return response.choices[0]?.message?.content ?? "";
}

// Log token usage + cache-hit stats for one response. OpenAI (and compatible
// gateways) report cached prefix tokens under usage.prompt_tokens_details
// .cached_tokens; a non-zero value means the prompt prefix was served from
// cache. Logged (not thrown) so it never affects the request. Set AI_LOG_USAGE
// to anything falsey-off ("0"/"false") to silence it.
function logUsage(label: string, usage: OpenAI.Completions.CompletionUsage | undefined) {
  if (!usage) return;
  const off = process.env.AI_LOG_USAGE?.toLowerCase();
  if (off === "0" || off === "false" || off === "no") return;

  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const prompt = usage.prompt_tokens ?? 0;
  const hitRate = prompt > 0 ? Math.round((cached / prompt) * 100) : 0;
  console.log(
    `[ai usage:${label}] prompt=${prompt} cached=${cached} (${hitRate}% hit) ` +
      `completion=${usage.completion_tokens ?? 0} total=${usage.total_tokens ?? 0}`,
  );
}

const CHAT_SYSTEM_PROMPT = `You are GemRadar AI, an expert crypto market analyst assistant.
You help users discover opportunities, analyze token growth potential, compare tokens, and find promising assets on various chains including BNB Chain and Solana.
Be concise, data-driven, and clearly state risks. Never guarantee returns.
When comparing tokens, use structured bullet points.
Do not provide financial advice — frame insights as educational analysis.

You have tools for live data — use them instead of guessing:
- search_tokens: resolve a Solana token name/symbol to its mint address.
- scan_token: pull a full safety + market snapshot for a Solana mint (authorities, holder concentration, age, RugCheck risk, LP lock, insider networks, live price).
- get_market_overview: current BTC dominance, Fear & Greed index, and top movers.
When the user asks about a specific Solana token's safety or whether it's a gem, scan it rather than relying on memory. If you only have a name, search_tokens first to get the mint. If a tool returns an error or no data, say so plainly instead of inventing numbers.`;

// A status event emitted while the agent runs tools, so the UI can show
// "Scanning token…" before the final answer streams. kind "tool" means a tool
// is running; kind "delta" carries a chunk of the final answer text.
export type AgentEvent =
  | { kind: "tool"; name: string }
  | { kind: "delta"; text: string };

const MAX_TOOL_ROUNDS = 4;

// Tool-aware chat: runs any tool calls the model requests (non-streaming) until
// it stops calling tools or we hit MAX_TOOL_ROUNDS, then streams the final
// answer. Yields AgentEvents so the caller can surface tool activity and then
// the streamed text. The tool loop itself is not streamed because tool_calls
// arrive incrementally and are awkward to assemble mid-stream; only the final
// user-facing answer needs the typewriter effect.
export async function* streamChatResponseWithTools(
  messages: ChatMessage[],
): AsyncIterable<AgentEvent> {
  const provider = resolveProvider();
  const client = provider === "openai" ? getOpenAIClient() : getFridayaixClient();
  const model = provider === "openai" ? OPENAI_MODEL : ANTHROPIC_MODEL;

  // Full OpenAI-shaped message list we grow as tools run.
  const convo: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: CHAT_SYSTEM_PROMPT },
    ...messages,
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.chat.completions.create({
      model,
      temperature: 0.7,
      max_tokens: 1200,
      tools: CHAT_TOOLS,
      messages: convo,
    });
    logUsage(`agent-round-${round}`, response.usage);

    const choice = response.choices[0]?.message;
    const toolCalls = choice?.tool_calls ?? [];

    if (!choice || toolCalls.length === 0) {
      // No tools requested — stream the final answer. If the model already
      // produced content here, emit it directly; otherwise do a fresh streamed
      // completion so the user still sees a typewriter effect.
      if (choice?.content) {
        yield { kind: "delta", text: choice.content };
        return;
      }
      break;
    }

    // Record the assistant turn (with its tool_calls) then run each tool and
    // append the results, so the next round sees them.
    convo.push(choice as OpenAI.Chat.Completions.ChatCompletionMessageParam);

    for (const call of toolCalls) {
      if (call.type !== "function") continue;
      yield { kind: "tool", name: call.function.name };
      const result = await runTool(call.function.name, call.function.arguments);
      convo.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  // Final pass: stream the answer now that tool results are in the context.
  // Pass tool_choice "none" so this pass commits to prose instead of looping.
  const finalStream = await client.chat.completions.create({
    model,
    temperature: 0.7,
    max_tokens: 1200,
    tools: CHAT_TOOLS,
    tool_choice: "none",
    stream: true,
    // Ask for a trailing usage-only chunk so we can log cache stats for the
    // streamed answer too (the per-delta chunks carry no usage).
    stream_options: { include_usage: true },
    messages: convo,
  });

  for await (const chunk of finalStream) {
    // The final usage-only chunk has an empty choices array; log and skip it.
    if (chunk.usage) logUsage("agent-final", chunk.usage);
    const delta = chunk.choices[0]?.delta?.content;
    if (typeof delta === "string") yield { kind: "delta", text: delta };
  }
}

const GEM_SYSTEM_PROMPT = `You analyze low-cap crypto tokens for hidden gem potential.
Return JSON: { "gems": [ { "symbol", "name", "gemScore" (1-10), "riskScore" (1-10), "potentialUpside" (short string like "2-5x medium-term"), "explanation" (1-2 sentences) } ] }
Analyze each token in the input array. gemScore = opportunity quality, riskScore = higher means riskier.
Be realistic and highlight liquidity/market cap risks.
Respond with the JSON object only, no markdown fences or commentary.`;

export async function analyzeGems(tokens: MarketToken[]): Promise<GemAnalysis[]> {
  if (tokens.length === 0) return [];

  const payload = tokens.slice(0, 15).map((t) => ({
    symbol: t.symbol,
    name: t.name,
    price: t.price,
    marketCap: t.marketCap,
    volume24h: t.volume24h,
    percentChange24h: t.percentChange24h,
    rank: t.rank,
  }));

  const raw = (
    await complete({
      system: GEM_SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(payload) }],
      temperature: 0.4,
      maxTokens: 4000,
    })
  ).trim();

  if (!raw) return [];

  let parsedData;
  try {
    parsedData = JSON.parse(stripJsonFences(raw));
  } catch (err) {
    console.error("JSON Parse Error in AI analysis:", err);
    console.error("Raw LLM response was:", raw);
    throw err;
  }
  const parsed = parsedData as {
    gems: {
      symbol: string;
      name: string;
      gemScore: number;
      riskScore: number;
      potentialUpside: string;
      explanation: string;
    }[];
  };

  const tokenMap = new Map(tokens.map((t) => [t.symbol.toUpperCase(), t]));

  return (parsed.gems ?? [])
    .map((g) => {
      const token = tokenMap.get(g.symbol.toUpperCase());
      if (!token) return null;
      return {
        symbol: g.symbol,
        name: g.name,
        gemScore: Math.min(10, Math.max(1, Math.round(g.gemScore))),
        riskScore: Math.min(10, Math.max(1, Math.round(g.riskScore))),
        potentialUpside: g.potentialUpside,
        explanation: g.explanation,
        price: token.price,
        marketCap: token.marketCap,
        volume24h: token.volume24h,
        percentChange24h: token.percentChange24h,
      } satisfies GemAnalysis;
    })
    .filter((g): g is GemAnalysis => g !== null)
    .sort((a, b) => b.gemScore - a.gemScore);
}

function stripJsonFences(text: string): string {
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last >= first) {
    return text.substring(first, last + 1);
  }
  return text.trim();
}

const SOLANA_GEM_SYSTEM_PROMPT = `You analyze Solana SPL tokens for hidden gem potential using on-chain safety signals.
Each input token includes on-chain metrics that CoinMarketCap cannot provide:
- holderConcentrationTop10 (0-1): share of supply held by the 10 largest accounts. Above ~0.5 is a strong rug risk.
- largestHolderShare (0-1): single largest holder. A high value means one wallet can dump the market.
- holderCount (may be null): number of wallets holding the token. A low count (e.g. under a few hundred) means supply is concentrated and easy to manipulate; a healthy, growing count spreads risk. Null means unknown — do not penalize for a null value.
- mintAuthorityRevoked: if false, the team can still mint new supply and dilute holders.
- freezeAuthorityRevoked: if false, the token can be frozen — a honeypot indicator.
- ageSeconds: time since first on-chain activity. Very young = high risk, high upside.
- liquidity (may be null): { baseAmount, quoteAmount, quoteSymbol } — real token amounts in the DEX pool vaults. Thin quoteAmount means the market can be moved (or exited) with little capital, a rug/illiquidity risk. Null means liquidity is unknown, not zero — do not penalize for a null value.
- rugcheck (may be null): { scoreNormalised (0-100, higher = riskier per RugCheck), topRisks (names of the most notable flags), lpLockedPct (0-100, share of LP tokens locked; null = no market data), insiderNetworkCount (number of coordinated insider/trade wallet clusters RugCheck detected), totalMarketLiquidity (aggregate USD liquidity per RugCheck) } — an independent third-party risk assessment. A high scoreNormalised (e.g. above ~50) or alarming topRisks (e.g. "Mint Authority", "Freeze Authority", "Low Liquidity", "Top 10 holders high") corroborates or overrides the raw signals above. A low lpLockedPct (e.g. under ~50) means LP can be pulled — a rug risk; a high value is reassuring. Any insiderNetworkCount above 0 signals coordinated wallets that often precede a dump — raise riskScore as the count grows. Very low totalMarketLiquidity means the market can be moved or exited with little capital. Null means RugCheck had no data — do not penalize for a null value, and treat individual null/absent sub-fields the same way.
Weight riskScore heavily on these signals: un-revoked authorities or >0.5 concentration should push riskScore to 8-10. Very thin pool liquidity should also raise riskScore. A high RugCheck scoreNormalised should raise riskScore even if the raw signals look benign.
Return JSON: { "gems": [ { "symbol", "name", "gemScore" (1-10), "riskScore" (1-10), "potentialUpside" (short string like "2-5x medium-term"), "explanation" (1-2 sentences citing the on-chain signals) } ] }
Match each output "symbol" exactly to an input "symbol".
Respond with the JSON object only, no markdown fences or commentary.`;

export interface SolanaGemInput {
  symbol: string;
  name: string;
  onChain: SolanaOnChainMetrics;
  // Optional market context if the caller has it (e.g. matched a CMC listing).
  price?: number;
  marketCap?: number;
  volume24h?: number;
  percentChange24h?: number;
}

export async function analyzeSolanaGems(
  inputs: SolanaGemInput[],
): Promise<SolanaGemAnalysis[]> {
  if (inputs.length === 0) return [];

  const payload = inputs.slice(0, 15).map((t) => ({
    symbol: t.symbol,
    name: t.name,
    holderConcentrationTop10: Number(t.onChain.holderConcentrationTop10.toFixed(4)),
    largestHolderShare: Number(t.onChain.largestHolderShare.toFixed(4)),
    holderCount: t.onChain.holderCount,
    mintAuthorityRevoked: t.onChain.mintAuthorityRevoked,
    freezeAuthorityRevoked: t.onChain.freezeAuthorityRevoked,
    ageSeconds: t.onChain.ageSeconds,
    supply: t.onChain.supply,
    liquidity: t.onChain.liquidity,
    rugcheck: t.onChain.rugcheck,
    price: t.price,
    marketCap: t.marketCap,
    volume24h: t.volume24h,
    percentChange24h: t.percentChange24h,
  }));

  // Append the outcome-memory calibration (empty string until there's enough
  // classified history), so the model is nudged by its own past hit/miss rates.
  // Degrades to the base prompt if the store read fails.
  let calibration = "";
  try {
    calibration = renderCalibrationPrompt(await getScoringCalibration());
  } catch {
    calibration = "";
  }

  const raw = (
    await complete({
      system: SOLANA_GEM_SYSTEM_PROMPT + calibration,
      messages: [{ role: "user", content: JSON.stringify(payload) }],
      temperature: 0.4,
      maxTokens: 4000,
    })
  ).trim();

  if (!raw) return [];

  let parsedData;
  try {
    parsedData = JSON.parse(stripJsonFences(raw));
  } catch (err) {
    console.error("JSON Parse Error in AI analysis:", err);
    console.error("Raw LLM response was:", raw);
    throw err;
  }
  const parsed = parsedData as {
    gems: {
      symbol: string;
      name: string;
      gemScore: number;
      riskScore: number;
      potentialUpside: string;
      explanation: string;
    }[];
  };

  const inputMap = new Map(inputs.map((t) => [t.symbol.toUpperCase(), t]));

  return (parsed.gems ?? [])
    .map((g) => {
      const input = inputMap.get(g.symbol.toUpperCase());
      if (!input) return null;
      return {
        symbol: g.symbol,
        name: g.name,
        gemScore: Math.min(10, Math.max(1, Math.round(g.gemScore))),
        riskScore: Math.min(10, Math.max(1, Math.round(g.riskScore))),
        potentialUpside: g.potentialUpside,
        explanation: g.explanation,
        price: input.price ?? 0,
        marketCap: input.marketCap ?? 0,
        volume24h: input.volume24h ?? 0,
        percentChange24h: input.percentChange24h ?? 0,
        mint: input.onChain.mint,
        onChain: input.onChain,
      } satisfies SolanaGemAnalysis;
    })
    .filter((g): g is SolanaGemAnalysis => g !== null)
    .sort((a, b) => b.gemScore - a.gemScore);
}
