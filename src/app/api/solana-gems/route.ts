import { NextResponse } from "next/server";
import { checkHealth } from "@/lib/flux";
import { enrichWithOnChain, type PoolVaults } from "@/lib/flux-solana";
import { getRugcheckReportBulk, getRugcheckValidation } from "@/lib/rugcheck";
import { getJupiterPrices } from "@/lib/jupiter";
import { getDexScreenerData } from "@/lib/dexscreener";
import { analyzeSolanaGems, type SolanaGemInput } from "@/lib/ai";
import { computeGemScore } from "@/lib/gem-score";
import { getRecentMints } from "@/lib/recent-mints";
import { getSocialSignalsBulk, upsertWatchlist } from "@/lib/social-store";
import { shouldTrackSocial, getSocialMonitorConfig } from "@/lib/social-config";
import { getXProfileMetrics, computeXScore } from "@/lib/x";
import type { SolanaRugcheckSignal } from "@/lib/types";
import { maybeEnterPositions } from "@/lib/trade-entry";
import { recordGemOutcome } from "@/lib/gem-outcomes-store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface RequestToken {
  mint: string;
  symbol: string;
  name?: string;
  price?: number;
  marketCap?: number;
  volume24h?: number;
  percentChange24h?: number;
  vaults?: PoolVaults; // optional pool vaults to measure liquidity
}

const MAX_TOKENS = 15;
// Base58 (Solana addresses exclude 0, O, I, l), typically 32-44 chars.
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function POST(request: Request) {
  try {
    // Body is optional. With { tokens: [...] } we scan those; with an empty or
    // missing body we auto-scan the most recent mints seen on the RugCheck live
    // stream, pre-filtered to skip the obviously-toxic ones.
    const body = await request.json().catch(() => ({}) as { tokens?: RequestToken[] });
    const rawTokens = body?.tokens;

    let tokens: RequestToken[];
    let source: "client" | "recent-feed";

    if (Array.isArray(rawTokens) && rawTokens.length > 0) {
      tokens = rawTokens.slice(0, MAX_TOKENS);
      source = "client";
    } else {
      // Auto-scan: recent mints, newest-first, seen in the last 30 minutes, with
      // a RugCheck score that isn't already high-risk. This is a coarse pre-cut;
      // the full gem score is computed below.
      const recent = getRecentMints(MAX_TOKENS, {
        maxScore: 60,
        maxAgeMs: 30 * 60_000,
      });
      if (recent.length === 0) {
        return NextResponse.json({
          gems: [],
          enrichedCount: 0,
          failures: [],
          source: "recent-feed",
          message:
            "No recent Solana mints buffered yet. Keep the Live RugCheck Feed open for a moment, then scan again.",
        });
      }
      tokens = recent.map((r) => ({
        mint: r.mint,
        symbol: r.symbol || r.mint.slice(0, 4),
        name: r.name || r.symbol || r.mint.slice(0, 4),
      }));
      source = "recent-feed";
    }

    const invalid = tokens.find((t) => !t.mint || !MINT_RE.test(t.mint));
    if (invalid) {
      return NextResponse.json(
        { error: `Invalid Solana mint address: ${invalid.mint ?? "(missing)"}` },
        { status: 400 },
      );
    }

    const badVault = tokens.find(
      (t) => t.vaults && (!MINT_RE.test(t.vaults.baseVault) || !MINT_RE.test(t.vaults.quoteVault)),
    );
    if (badVault) {
      return NextResponse.json(
        { error: `Invalid vault address for mint ${badVault.mint}` },
        { status: 400 },
      );
    }

    // Health check, RugCheck bulk lookup, and Jupiter prices are independent —
    // run in parallel. The RugCheck bulk report adds LP-lock, insider-network,
    // and liquidity signals on top of the score. Jupiter adds live price +
    // aggregate liquidity + 24h change (free, no key). Both degrade to empty
    // maps (no key / outage), so neither blocks.
    const mints = tokens.map((t) => t.mint);
    const [health, rugcheckMap, jupiterMap, dexMap, socialMap] = await Promise.all([
      checkHealth(),
      getRugcheckReportBulk(mints),
      getJupiterPrices(mints),
      // DexScreener: real 24h volume + buy/sell counts (free, no key). Fills the
      // volume gap and powers the money-flow category.
      getDexScreenerData(mints),
      // Social scores produced by the Telegram worker (Phase 4). Empty until the
      // worker has run for these mints — scoreSocial then reports not-covered.
      getSocialSignalsBulk(mints),
    ]);
    if (!health.healthy) {
      return NextResponse.json(
        { error: `Flux RPC node unhealthy: ${health.detail}` },
        { status: 503 },
      );
    }

    const enriched = await Promise.allSettled(
      tokens.map(async (t): Promise<SolanaGemInput> => {
        const report = rugcheckMap.get(t.mint);
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
        const onChain = await enrichWithOnChain(t.mint, t.vaults, rugcheck);
        const jup = jupiterMap.get(t.mint);
        const dex = dexMap.get(t.mint);

        // Prefer caller-supplied market context, then DexScreener, then Jupiter.
        // Market cap falls back to Jupiter price × on-chain supply when neither
        // source reports it.
        const price = t.price ?? jup?.usdPrice ?? undefined;
        const marketCap =
          t.marketCap ??
          dex?.marketCap ??
          (jup?.usdPrice != null && onChain.supply > 0
            ? jup.usdPrice * onChain.supply
            : undefined);

        return {
          symbol: t.symbol,
          name: t.name ?? t.symbol,
          onChain,
          price,
          marketCap,
          volume24h: t.volume24h ?? dex?.volume24h ?? undefined,
          percentChange24h:
            t.percentChange24h ?? dex?.priceChange24h ?? jup?.priceChange24h ?? undefined,
        };
      }),
    );

    const inputs: SolanaGemInput[] = [];
    const failures: { mint: string; reason: string }[] = [];
    enriched.forEach((res, i) => {
      if (res.status === "fulfilled") {
        inputs.push(res.value);
      } else {
        failures.push({
          mint: tokens[i].mint,
          reason: res.reason instanceof Error ? res.reason.message : String(res.reason),
        });
      }
    });

    if (inputs.length === 0) {
      return NextResponse.json(
        { error: "On-chain enrichment failed for all tokens", failures, source },
        { status: 502 },
      );
    }

    // X (Twitter) presence, only when enabled in config AND a bearer token is
    // set. Resolve each token's X handle from RugCheck validation, then fetch
    // profile metrics → xScore. The validation results are reused below for the
    // Telegram watchlist so RugCheck isn't queried twice. Everything degrades to
    // null, so a disabled/rate-limited X never affects the scan.
    const cfg = getSocialMonitorConfig();
    const xEnabled = cfg.x.enabled && cfg.x.source === "official" && !!process.env.X_BEARER_TOKEN;

    const validationByMint = new Map<string, { twitter: string | null; telegram: string | null }>();
    const xScoreByMint = new Map<string, number>();

    if (xEnabled) {
      const validations = await Promise.allSettled(
        inputs.map((inp) => getRugcheckValidation(inp.onChain.mint)),
      );
      const xTargets: { mint: string; handle: string }[] = [];
      validations.forEach((v, i) => {
        const mint = inputs[i].onChain.mint;
        if (v.status === "fulfilled") {
          const twitter = v.value.socials?.twitter ?? null;
          validationByMint.set(mint, {
            twitter,
            telegram: v.value.socials?.telegram ?? null,
          });
          if (twitter) xTargets.push({ mint, handle: twitter });
        }
      });

      // Cap X calls per scan (paid API, low rate limits).
      const capped = xTargets.slice(0, cfg.x.maxAccountsPerRun);
      const metrics = await Promise.allSettled(
        capped.map((t) => getXProfileMetrics(t.handle)),
      );
      metrics.forEach((res, i) => {
        if (res.status === "fulfilled" && res.value) {
          xScoreByMint.set(
            capped[i].mint,
            computeXScore(res.value, cfg.x.maxAccountAgeDaysForCaution),
          );
        }
      });
    }

    // Deterministic gem score per token (gem-score.md weights), keyed by mint so
    // it can be merged onto the AI analysis. Uses the same Jupiter data the AI
    // sees, so the score and the explanation are consistent.
    const scoreByMint = new Map(
      inputs.map((inp) => {
        const mint = inp.onChain.mint;
        const jup = jupiterMap.get(mint);
        // socialMap already merges the TG worker's socialScore and the X buzz
        // worker's scraped xScore (via social-store). The paid X API score, when
        // the official-source path produced one, is the stronger signal and
        // overrides the scraped xScore.
        const fileSignal = socialMap.get(mint);
        const paidXScore = xScoreByMint.get(mint);
        const xScore = paidXScore ?? fileSignal?.xScore;
        const socialScore = fileSignal?.socialScore;
        // Build a SocialSignals only from the fields that are actually present;
        // undefined fields are left out so gem-score.scoreSocial treats them as
        // absent rather than 0.
        const social: { socialScore?: number; xScore?: number } | null =
          socialScore != null || xScore != null
            ? {
                ...(socialScore != null ? { socialScore } : {}),
                ...(xScore != null ? { xScore } : {}),
              }
            : null;
        return [
          mint,
          computeGemScore({
            onChain: inp.onChain,
            jupiter: jup
              ? {
                  usdPrice: jup.usdPrice,
                  liquidity: jup.liquidity,
                  priceChange24h: jup.priceChange24h,
                }
              : null,
            dex: dexMap.get(mint) ?? null,
            social,
          }),
        ] as const;
      }),
    );

    const gems = await analyzeSolanaGems(inputs);
    const scored = gems.map((g) => ({
      ...g,
      breakdown: scoreByMint.get(g.mint) ?? null,
    }));

    // Only high-scoring gems get tracked on social — both the AI gemScore and
    // the deterministic total must clear the thresholds in
    // social-monitor.config.json (with enough coverage). This keeps the Telegram
    // worker from joining channels for low-quality tokens.
    const trackable = scored.filter((g) =>
      shouldTrackSocial({
        gemScoreAi: g.gemScore,
        gemScoreTotal: g.breakdown?.total ?? 0,
        coverage: g.breakdown?.coverage ?? 0,
      }),
    );

    // Resolve each trackable gem's official Telegram and hand the list to the
    // Telegram worker via watchlist.json. Reuse the RugCheck validation already
    // fetched for X (if any) so RugCheck isn't queried twice; only look up mints
    // we don't have yet. Best-effort: a failure here must not fail the scan.
    if (trackable.length > 0) {
      try {
        const needLookup = trackable.filter((g) => !validationByMint.has(g.mint));
        const looked = await Promise.allSettled(
          needLookup.map((g) => getRugcheckValidation(g.mint)),
        );
        looked.forEach((v, i) => {
          if (v.status === "fulfilled") {
            validationByMint.set(needLookup[i].mint, {
              twitter: v.value.socials?.twitter ?? null,
              telegram: v.value.socials?.telegram ?? null,
            });
          }
        });
        const watch = trackable.map((g) => ({
          mint: g.mint,
          telegram: validationByMint.get(g.mint)?.telegram ?? null,
          symbol: g.symbol,
        }));
        await upsertWatchlist(watch);
      } catch (e) {
        console.error("[/api/solana-gems] watchlist update failed:", e);
      }
    }

    // Outcome memory: record every scored gem + its price now, so the reconcile
    // worker can later measure how it performed and feed that back into the AI
    // prompt. Fire-and-forget: a store failure must never fail the scan. Written
    // sequentially inside one promise to avoid racing the store's atomic write.
    void (async () => {
      try {
        for (const g of scored) {
          await recordGemOutcome({
            mint: g.mint,
            symbol: g.symbol,
            hardScore: g.breakdown?.total ?? 0,
            aiGemScore: g.gemScore,
            riskScore: g.riskScore,
            coverage: g.breakdown?.coverage ?? 0,
            insiderNetworkCount: g.onChain.rugcheck?.insiderNetworkCount ?? null,
            priceAtScore: jupiterMap.get(g.mint)?.usdPrice ?? null,
          });
        }
      } catch (e) {
        console.error("[/api/solana-gems] outcome record failed:", e);
      }
    })();

    // Auto-trade entry (dry-run unless the live gate is open). Best-effort: a
    // failure here must never fail the scan response.
    try {
      const decisions = await maybeEnterPositions(scored);
      const bought = decisions.filter((d) => d.action === "bought");
      if (bought.length > 0) {
        console.log(
          `[/api/solana-gems] auto-trade: ${bought.map((b) => `${b.symbol}(${b.mode})`).join(", ")}`,
        );
      }
    } catch (e) {
      console.error("[/api/solana-gems] auto-trade entry failed:", e);
    }

    return NextResponse.json({
      gems: scored,
      enrichedCount: inputs.length,
      failures,
      source,
    });
  } catch (error) {
    console.error("[/api/solana-gems]", error);
    const message = error instanceof Error ? error.message : "Solana gem scan failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
