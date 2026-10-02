Verified .token Domains
curl -X GET "https://api.rugcheck.xyz/v1/domains?page=1&limit=3&verified=true" \
  -H "accept: application/json"
  curl -X GET "https://api.rugcheck.xyz/v1/domains/lookup/mytoken.token"
  Token Locker Vaults
  curl -X 'GET' \
  'https://api.rugcheck.xyz/v1/tokens/6z9XSmYTZffoPUrpuManU7rxjfn7naEbWnDacdAXbonk/lockers' \
  -H 'accept: application/json' \
  -H "X-API-KEY: <your-API-key>"
  {
  "lockers": {
    "9jD97e1U6J2Ld9exjuQ3nv3xfJQwUWyVXnKwfGgYNvyT": {
      "programID": "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
      "tokenAccount": "11111111111111111111111111111111",
      "owner": "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
      "uri": "https://raydium.io/liquidity/increase/?mode=add&pool_id=79ZfRapqeW8gCa5uYbNN1owxX54hnfxCfWkT45nfAhUY",
      "unlockDate": 0,
      "usdcLocked": 14484.915709904704,
      "type": "raydium_locker"
    }
  },
  "total": {
    "totalUSDC": 15532.44236441391
  }
}
FluxBeam Locker Vaults
curl -X 'GET' \
  'https://api.rugcheck.xyz/v1/tokens/6z9XSmYTZffoPUrpuManU7rxjfn7naEbWnDacdAXbonk/lockers/flux' \
  -H 'accept: application/json' \
  -H "X-API-KEY: <your-API-key>"
  Submit Token Vote
  curl -X POST "https://api.rugcheck.xyz/v1/tokens/TokenMintAddress/vote" \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: <your-API-key>" \
  -d '{
    "mint": "TokenMintAddress",
    "side": true
  }'
  curl -X GET "https://api.rugcheck.xyz/v1/tokens/TokenMintAddress/votes"