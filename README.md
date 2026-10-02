# AlphaHunter AI

Production-ready crypto intelligence dashboard with AI chat, live market widgets, and a **Hidden Gems** scanner powered by CoinMarketCap + Claude (via FridayAIX).

![Next.js](https://img.shields.io/badge/Next.js-15%2B-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Tailwind](https://img.shields.io/badge/Tailwind-4-38bdf8)

## Features

- **Dark crypto dashboard** — three-panel layout (market stats · AI chat · trending)
- **Left sidebar** — BTC dominance, top gainers/losers, Fear & Greed index
- **Center panel** — AI chat for token research, comparisons, and chain analysis
- **Right sidebar** — trending tokens by 24h volume
- **Find Hidden Gems** — filters CMC listings (cap &lt; $50M, volume &gt; $100K, positive 24h) and scores them with AI
- **API routes** — `/api/chat`, `/api/gems`, `/api/market`
- **Responsive** — mobile-friendly stacked layout, desktop three-column grid
- **Vercel-ready** — deploy with environment variables

## Stack

- Next.js App Router (15+)
- TypeScript
- Tailwind CSS v4
- shadcn/ui-style components (Radix + CVA)
- Anthropic SDK via [FridayAIX](https://oneai.fridayaix.com/) gateway (`claude-sonnet-4-6`)
- CoinMarketCap Pro API
- Alternative.me Fear & Greed (no key required)

## Getting Started

### 1. Clone and install

```bash
cd alphahunter-ai
npm install
```

### 2. Environment variables

Copy `.env.example` to `.env.local` and add your keys:

```bash
cp .env.example .env.local
```

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_BASE_URL` | FridayAIX gateway URL (`https://oneai.fridayaix.com/`) |
| `ANTHROPIC_AUTH_TOKEN` | FridayAIX API key |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | Chat/analysis model (defaults to `claude-sonnet-4-6`) |
| `COINMARKETCAP_API_KEY` | [CoinMarketCap Pro](https://coinmarketcap.com/api/) API key |

### 3. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 4. Build for production

```bash
npm run build
npm start
```

## Deploy on Vercel

1. Push this repo to GitHub.
2. Import the project in [Vercel](https://vercel.com/new).
3. Add `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, and `COINMARKETCAP_API_KEY` in **Project → Settings → Environment Variables**.
4. Deploy.

## API Reference

### `POST /api/chat`

```json
{
  "messages": [
    { "role": "user", "content": "Compare SOL and AVAX" }
  ]
}
```

### `POST /api/gems`

Runs the hidden gem pipeline (CMC filter → Claude analysis). No body required.

### `GET /api/market`

Returns BTC dominance, gainers, losers, trending, and Fear & Greed data.

## Hidden Gem Criteria

| Filter | Value |
|--------|-------|
| Market cap | &lt; $50,000,000 |
| 24h volume | &gt; $100,000 |
| 24h change | Positive |

Up to 15 candidates are sent to Claude for Gem Score, Risk Score, upside, and explanation.

## Disclaimer

This app is for educational and research purposes only. Not financial advice. Crypto assets are highly risky.

## License

MIT
