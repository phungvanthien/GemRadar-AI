export interface MarketToken {
  id: number;
  name: string;
  symbol: string;
  slug: string;
  price: number;
  marketCap: number;
  volume24h: number;
  percentChange24h: number;
  percentChange7d?: number;
  rank: number;
}

export interface MarketOverview {
  btcDominance: number;
  totalMarketCap: number;
  fearGreedIndex: number;
  fearGreedLabel: string;
  topGainers: MarketToken[];
  topLosers: MarketToken[];
  trending: MarketToken[];
  updatedAt: string;
}

export interface GemAnalysis {
  symbol: string;
  name: string;
  gemScore: number;
  riskScore: number;
  potentialUpside: string;
  explanation: string;
  price: number;
  marketCap: number;
  volume24h: number;
  percentChange24h: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
