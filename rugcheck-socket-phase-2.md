token report summary 
const tokenMint = 'eb5U8spZFfJUUTS4RoterQTVTKwctzMRcd4PctZpump';
const response = await fetch(`https://api.rugcheck.xyz/v1/tokens/${tokenMint}/report/summary`, {
  headers: { accept: 'application/json' },
});
const data = await response.json();
console.log(data);
{
  "tokenProgram": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "tokenType": "",
  "risks": [
    {
      "name": "Low Liquidity",
      "value": "$2228.92",
      "description": "Low amount of liquidity in the token pool",
      "score": 771,
      "level": "warn"
    },
    {
      "name": "Low amount of LP Providers",
      "value": "",
      "description": "Only a few users are providing liquidity",
      "score": 500,
      "level": "warn"
    }
  ],
  "score": 1272,
  "score_normalised": 24,
  "lpLockedPct": 100
}
report token 
const tokenMint = 'TokenMintAddress';
const response = await fetch(`https://api.rugcheck.xyz/v1/tokens/${tokenMint}/report`, {
  method: 'POST',
  headers: {
    'X-API-KEY': '<your-API-key>'
  }
});
const data = await response.json();
console.log(data);
