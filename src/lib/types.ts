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

export interface SolanaOnChainMetrics {
  mint: string;
  decimals: number;
  supply: number;
  holderConcentrationTop10: number; // 0-1, share of supply held by the 10 largest accounts
  largestHolderShare: number; // 0-1, share held by the single largest account
  holderCount: number | null; // count of non-empty token accounts; null when unavailable
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  ageSeconds: number | null; // time since the first known signature for this mint
  liquidity: SolanaPoolLiquidity | null; // null when no pool vaults were supplied
  rugcheck: SolanaRugcheckSignal | null; // third-party risk score; null when unavailable
}

export interface SolanaRugcheckSignal {
  scoreNormalised: number; // 0-100, higher = riskier (RugCheck's scale)
  topRisks: string[]; // names of the most notable risk flags RugCheck raised
  // The fields below come from the fuller bulk report; they are absent when
  // only the lightweight summary was fetched.
  lpLockedPct?: number | null; // highest LP lock across markets, 0-100; null if no market data
  insiderNetworkCount?: number; // number of coordinated insider/trade networks RugCheck detected
  totalMarketLiquidity?: number; // aggregate USD liquidity across markets, per RugCheck
}

export interface SolanaPoolLiquidity {
  baseAmount: number; // token amount in the base vault (this mint), UI units
  quoteAmount: number; // token amount in the quote vault (e.g. SOL/USDC), UI units
  quoteSymbol: string; // label for the quote side, caller-provided (default "quote")
}

export interface SolanaGemAnalysis extends GemAnalysis {
  mint: string;
  onChain: SolanaOnChainMetrics;
}

// A live token report pushed by the RugCheck WebSocket stream, trimmed to the
// gem-relevant fields. The full parsed frame is available in `raw` for callers
// that need more. score is RugCheck's raw score; scoreNormalised is 0-100
// (higher = riskier). liquidity/holders are absent until the report includes
// market data.
export interface RugcheckStreamToken {
  mint: string;
  symbol: string;
  name: string;
  creator: string;
  score: number;
  scoreNormalised: number;
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  totalMarketLiquidity: number | null;
  totalHolders: number | null;
  topRisks: string[]; // names of the most notable risk flags, highest score first
  receivedAt: string; // ISO-8601 timestamp when the proxy observed the frame
}
