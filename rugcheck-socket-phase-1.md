wss://api.rugcheck.xyz/ws
wss://api.rugcheck.xyz/ws/insider-networks
token search: 
// Aborting the previous request keeps a fast typist from racing
// stale responses onto the screen.
let controller;

async function searchTokens(query, limit = 20) {
  controller?.abort();
  controller = new AbortController();

  const params = new URLSearchParams({ limit: String(limit) });
  // Omit q entirely when empty - that returns trending tokens.
  if (query.trim()) params.set('q', query.trim());

  const response = await fetch(`https://api.rugcheck.xyz/v1/search?${params}`, {
    signal: controller.signal,
  });
  if (!response.ok) throw new Error(`Search failed: ${response.status}`);
  return await response.json();
}

const results = await searchTokens('bonk', 10);
console.log(results);

token report
{
  "mint": "TokenMintAddress",
  "tokenProgram": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "creator": "CreatorPublicKey",
  "creatorBalance": 1000000000,
  "token": {
    "mintAuthority": null,
    "supply": 1000000000000,
    "decimals": 9,
    "isInitialized": true,
    "freezeAuthority": null
  },
  "tokenMeta": {
    "name": "Token Name",
    "symbol": "TKN",
    "uri": "https://ipfs.io/ipfs/...",
    "mutable": false
  },
  "topHolders": [
    {
      "address": "HolderAddress",
      "amount": 50000000000,
      "decimals": 9,
      "pct": 5.0,
      "uiAmount": 50.0,
      "uiAmountString": "50.0",
      "owner": "OwnerAddress",
      "insider": false
    }
  ],
  "risks": [
    {
      "name": "Low Liquidity",
      "value": "$2228.92",
      "description": "Low amount of liquidity in the token pool",
      "score": 771,
      "level": "warn"
    }
  ],
  "score": 1272,
  "score_normalised": 24,
  "markets": [
    {
      "pubkey": "MarketPublicKey",
      "marketType": "raydium",
      "lp": {
        "baseMint": "TokenMintAddress",
        "quoteMint": "So11111111111111111111111111111111111111112",
        "basePrice": 0.001,
        "quotePrice": 100.0,
        "lpLockedPct": 75.5
      }
    }
  ],
  "totalMarketLiquidity": 50000.0,
  "price": 0.001,
  "insiderNetworks": [
    {
      "id": "network-identifier",
      "size": 50,
      "type": "trade",
      "tokenAmount": 1000000,
      "activeAccounts": 25
    }
  ],
  "verification": {
    "jup_verified": false,
    "jup_strict": false
  }
}