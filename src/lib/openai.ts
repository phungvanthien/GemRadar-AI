import OpenAI from "openai";
import type { GemAnalysis, MarketToken } from "./types";

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  return new OpenAI({ apiKey });
}

const CHAT_SYSTEM_PROMPT = `You are AlphaHunter AI, an expert crypto market analyst assistant.
You help users discover opportunities, analyze token growth potential, compare tokens, and find promising assets on various chains including BNB Chain.
Be concise, data-driven, and clearly state risks. Never guarantee returns.
When comparing tokens, use structured bullet points.
If you lack live data, say so and provide general analytical frameworks.
Do not provide financial advice — frame insights as educational analysis.`;

export async function generateChatResponse(
  messages: { role: "user" | "assistant"; content: string }[]
): Promise<string> {
  const client = getClient();
  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.7,
    max_tokens: 1200,
    messages: [{ role: "system", content: CHAT_SYSTEM_PROMPT }, ...messages],
  });

  return response.choices[0]?.message?.content ?? "I couldn't generate a response. Please try again.";
}

export async function analyzeGems(tokens: MarketToken[]): Promise<GemAnalysis[]> {
  if (tokens.length === 0) return [];

  const client = getClient();
  const payload = tokens.slice(0, 15).map((t) => ({
    symbol: t.symbol,
    name: t.name,
    price: t.price,
    marketCap: t.marketCap,
    volume24h: t.volume24h,
    percentChange24h: t.percentChange24h,
    rank: t.rank,
  }));

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.4,
    max_tokens: 4000,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You analyze low-cap crypto tokens for hidden gem potential.
Return JSON: { "gems": [ { "symbol", "name", "gemScore" (1-10), "riskScore" (1-10), "potentialUpside" (short string like "2-5x medium-term"), "explanation" (1-2 sentences) } ] }
Analyze each token in the input array. gemScore = opportunity quality, riskScore = higher means riskier.
Be realistic and highlight liquidity/market cap risks.`,
      },
      {
        role: "user",
        content: JSON.stringify(payload),
      },
    ],
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) return [];

  const parsed = JSON.parse(raw) as {
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
