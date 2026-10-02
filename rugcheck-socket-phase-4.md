Bulk Token Summary
const response = await fetch('https://api.rugcheck.xyz/v1/bulk/tokens/summary', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-KEY': '<your-API-key>'
  },
  body: JSON.stringify({
    tokens: [
      'eb5U8spZFfJUUTS4RoterQTVTKwctzMRcd4PctZpump',
      '8JxfHVpnqHeSz99w9XfBwT2uaKHFNU72RNYxrbrxdj69'
    ]
  })
});
const data = await response.json();
console.log(data);
[
  {
    "mint": "eb5U8spZFfJUUTS4RoterQTVTKwctzMRcd4PctZpump",
    "score": 250,
    "score_normalised": 75,
    "risks": [...]
  },
  {
    "mint": "8JxfHVpnqHeSz99w9XfBwT2uaKHFNU72RNYxrbrxdj69",
    "score": 150,
    "score_normalised": 45,
    "risks": [...]
  }
]
Token Domain Eligibility
const response = await fetch('https://api.rugcheck.xyz/v1/tokens/verify/eligible', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ mint: 'TokenMintAddress' })
});
const data = await response.json();
console.log(data);
Verified Token List
const response = await fetch('https://api.rugcheck.xyz/v1/tokens/verified?limit=20', {
  headers: {
    'accept': 'application/json',
    'X-API-KEY': '<your-API-key>'
  }
});
const { tokens, nextCursor } = await response.json();

// Pass nextCursor unchanged as ?cursor=... to fetch the next page.
console.log(tokens, nextCursor);
{
  "tokens": [
    {
      "mint": "TokenMintAddress",
      "payer": "VerificationPayerAddress",
      "name": "Example Token",
      "symbol": "EXAMPLE",
      "description": "Example RugCheck-verified token",
      "jup_verified": false,
      "jup_strict": false,
      "validated": true,
      "links": [
        {
          "provider": "website",
          "value": "https://example.com"
        }
      ]
    }
  ],
  "nextCursor": "opaque-cursor-from-response"
}

Token Verification Status
const validation = await fetch(
  `https://api.rugcheck.xyz/v1/tokens/${mint}/validation`,
).then((r) => r.json());

if (validation.validated) {
  console.log('Verified', validation.website);
}
{
  "mint": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  "validated": true,
  "website": "https://bonkcoin.com",
  "socials": {
    "twitter": "https://x.com/bonk_inu",
    "telegram": "https://t.me/bonk_inu"
  }
}
