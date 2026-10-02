"use client";

import {
  Gem,
  ShieldAlert,
  TrendingUp,
  Sparkles,
  AlertCircle,
  BarChart3,
  DollarSign,
  Activity,
  MessageCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatPercent } from "@/lib/utils";
import type { SolanaGemAnalysis } from "@/lib/types";
import type { GemScoreBreakdown } from "@/lib/gem-score";

// A gem returned by /api/solana-gems: the AI analysis plus the deterministic
// gem-score breakdown (null if scoring had no data for that mint).
export interface ScoredGem extends SolanaGemAnalysis {
  breakdown?: GemScoreBreakdown | null;
}

interface GemFailure {
  mint: string;
  reason: string;
}

interface GemCardsProps {
  gems: ScoredGem[];
  loading?: boolean;
  error?: string | null;
  emptyMessage?: string | null;
  failures?: GemFailure[];
  // Called when the user clicks "Ask AI" on a card — the parent injects a
  // context-rich prompt about this gem into the chat.
  onAskAI?: (gem: ScoredGem) => void;
  // Disables the Ask AI buttons while a chat request is in flight.
  askDisabled?: boolean;
}

function ScoreBar({ value, max = 10, color }: { value: number; max?: number; color: string }) {
  const pct = (value / max) * 100;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function MetricCell({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 p-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`mt-0.5 truncate text-sm font-semibold text-zinc-100 ${valueClassName ?? ""}`}>
        {value}
      </p>
    </div>
  );
}

function GemCardSkeleton() {
  return (
    <Card className="border-amber-500/10 overflow-hidden">
      <CardHeader className="pb-2">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="mt-2 h-4 w-40" />
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
        <Skeleton className="h-20 w-full" />
      </CardContent>
    </Card>
  );
}

function sortByGemScore(gems: ScoredGem[]): ScoredGem[] {
  return [...gems].sort((a, b) => b.gemScore - a.gemScore);
}

const CATEGORY_META: { key: keyof Omit<GemScoreBreakdown, "total" | "coverage">; label: string }[] = [
  { key: "security", label: "Security" },
  { key: "liquidity", label: "Liquidity" },
  { key: "moneyFlow", label: "Money Flow" },
  { key: "distribution", label: "Distribution" },
  { key: "social", label: "Social" },
];

function scoreColor(score: number): string {
  if (score >= 70) return "bg-emerald-500";
  if (score >= 40) return "bg-amber-500";
  return "bg-red-500";
}

// Coverage badge: green >=90%, amber 60-89%, red <60%. A quick read of how much
// of the model actually had data behind the score.
function coverageBadge(coverage: number): { variant: "success" | "default" | "danger"; label: string } {
  const pct = Math.round(coverage * 100);
  if (pct >= 90) return { variant: "success", label: `${pct}% data` };
  if (pct >= 60) return { variant: "default", label: `${pct}% data` };
  return { variant: "danger", label: `${pct}% data` };
}

// The deterministic gem-score breakdown: four category bars + a coverage note so
// the reader knows how much of the model actually had data behind it.
function ScoreBreakdown({ breakdown }: { breakdown: GemScoreBreakdown }) {
  return (
    <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Gem Score {breakdown.total}
          <span className="text-zinc-600">/100</span>
        </span>
        {(() => {
          const b = coverageBadge(breakdown.coverage);
          return (
            <Badge variant={b.variant} className="text-[10px]">
              {b.label}
            </Badge>
          );
        })()}
      </div>
      <div className="space-y-1.5">
        {CATEGORY_META.map(({ key, label }) => {
          const cat = breakdown[key];
          return (
            <div key={key} className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-[11px] text-zinc-500">{label}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                {cat.covered ? (
                  <div
                    className={`h-full rounded-full transition-all ${scoreColor(cat.score)}`}
                    style={{ width: `${cat.score}%` }}
                  />
                ) : null}
              </div>
              <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-zinc-400">
                {cat.covered ? Math.round(cat.score) : "n/a"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function GemCards({
  gems,
  loading,
  error,
  emptyMessage,
  failures = [],
  onAskAI,
  askDisabled,
}: GemCardsProps) {
  const sorted = sortByGemScore(gems);
  const showSection =
    loading || !!error || sorted.length > 0 || !!emptyMessage || failures.length > 0;

  if (!showSection) return null;

  return (
    <section className="mt-6 space-y-4" aria-live="polite" aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-5 text-amber-400" />
          <h3 className="text-lg font-semibold text-zinc-100">Hidden Gems</h3>
          {!loading && sorted.length > 0 && (
            <Badge variant="default">{sorted.length} analyzed</Badge>
          )}
        </div>
        {loading && (
          <span className="flex items-center gap-2 text-xs font-medium text-amber-400/90">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-amber-500" />
            </span>
            Scanning markets…
          </span>
        )}
      </div>

      {error && (
        <Card className="border-red-900/60 bg-red-950/30">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-red-400" />
            <div>
              <p className="text-sm font-medium text-red-300">Gem scan failed</p>
              <p className="mt-1 text-sm text-red-400/90">{error}</p>
              <p className="mt-2 text-xs text-zinc-500">
                Check your API keys and try again. Chat and market data are unaffected.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {loading && (
        <>
          <Card className="border-amber-500/20 bg-gradient-to-r from-zinc-900/80 to-zinc-950/80">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex size-10 items-center justify-center rounded-xl bg-amber-500/15">
                <Gem className="size-5 animate-pulse text-amber-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-200">Scanning for hidden gems</p>
                <p className="text-xs text-zinc-500">
                  Reading recent Solana mints, on-chain + RugCheck + Jupiter signals, then AI analysis…
                </p>
              </div>
            </CardContent>
          </Card>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <GemCardSkeleton key={i} />
            ))}
          </div>
        </>
      )}

      {!loading && !error && emptyMessage && sorted.length === 0 && (
        <Card className="border-zinc-800/80 bg-zinc-900/40">
          <CardContent className="p-4 text-center text-sm text-zinc-400">{emptyMessage}</CardContent>
        </Card>
      )}

      {!loading && sorted.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map((gem, index) => {
            const changePositive = gem.percentChange24h >= 0;
            return (
              <Card
                key={`${gem.symbol}-${index}`}
                className="group relative overflow-hidden border-amber-500/20 transition-all hover:border-amber-500/40 hover:shadow-lg hover:shadow-amber-500/5"
              >
                <div className="pointer-events-none absolute -right-10 -top-10 size-36 rounded-full bg-amber-500/5 blur-2xl" />
                {index === 0 && (
                  <div className="absolute right-3 top-3">
                    <Badge className="bg-amber-500/25 text-amber-200">Top pick</Badge>
                  </div>
                )}

                <CardHeader className="relative border-b border-zinc-800/60 pb-3">
                  <div className="flex items-start gap-3 pr-16">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500/25 to-orange-600/20 ring-1 ring-amber-500/30">
                      <span className="text-sm font-bold text-amber-300">{gem.symbol.slice(0, 3)}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <CardTitle className="truncate text-base leading-tight">{gem.name}</CardTitle>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Badge variant="muted">{gem.symbol}</Badge>
                        <span className="text-[10px] text-zinc-600">#{index + 1} by gem score</span>
                      </div>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="relative space-y-4 pt-4">
                  <div className="grid grid-cols-2 gap-2">
                    <MetricCell label="Current Price" value={formatCurrency(gem.price)} />
                    <MetricCell label="Market Cap" value={formatCurrency(gem.marketCap, true)} />
                    <MetricCell label="24h Volume" value={formatCurrency(gem.volume24h, true)} />
                    <MetricCell
                      label="24h Change"
                      value={formatPercent(gem.percentChange24h)}
                      valueClassName={changePositive ? "text-emerald-400" : "text-red-400"}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg bg-zinc-950/70 p-3 ring-1 ring-amber-500/10">
                      <div className="mb-1.5 flex items-center gap-1 text-xs text-zinc-500">
                        <Gem className="size-3.5 text-amber-400" />
                        Gem Score
                      </div>
                      <p className="text-2xl font-bold tabular-nums text-amber-400">
                        {gem.gemScore}
                        <span className="text-sm font-normal text-zinc-500">/10</span>
                      </p>
                      <ScoreBar
                        value={gem.gemScore}
                        color="bg-gradient-to-r from-amber-500 to-orange-500"
                      />
                    </div>
                    <div className="rounded-lg bg-zinc-950/70 p-3 ring-1 ring-red-500/10">
                      <div className="mb-1.5 flex items-center gap-1 text-xs text-zinc-500">
                        <ShieldAlert className="size-3.5 text-red-400" />
                        Risk Score
                      </div>
                      <p className="text-2xl font-bold tabular-nums text-red-400">
                        {gem.riskScore}
                        <span className="text-sm font-normal text-zinc-500">/10</span>
                      </p>
                      <ScoreBar
                        value={gem.riskScore}
                        color="bg-gradient-to-r from-red-500 to-orange-600"
                      />
                    </div>
                  </div>

                  {gem.breakdown && <ScoreBreakdown breakdown={gem.breakdown} />}

                  <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3">
                    <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-400">
                      <TrendingUp className="size-3.5" />
                      Potential Upside
                    </div>
                    <p className="text-sm font-semibold leading-snug text-emerald-300">
                      {gem.potentialUpside}
                    </p>
                  </div>

                  <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-3">
                    <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      <BarChart3 className="size-3.5 text-violet-400" />
                      AI Explanation
                    </div>
                    <p className="text-sm leading-relaxed text-zinc-400">{gem.explanation}</p>
                  </div>

                  {onAskAI && (
                    <button
                      type="button"
                      onClick={() => onAskAI(gem)}
                      disabled={askDisabled}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-sm font-medium text-violet-300 transition-colors hover:border-violet-500/50 hover:bg-violet-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <MessageCircle className="size-4" />
                      Ask AI about {gem.symbol}
                    </button>
                  )}

                  <div className="flex items-center justify-between border-t border-zinc-800/60 pt-2 text-[10px] text-zinc-600">
                    <span className="flex items-center gap-1 font-mono">
                      <DollarSign className="size-3" />
                      {gem.mint.slice(0, 4)}…{gem.mint.slice(-4)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Activity className="size-3" />
                      AI scored
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {!loading && failures.length > 0 && (
        <Card className="border-zinc-800/80 bg-zinc-900/40">
          <CardContent className="p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-zinc-500">
              <AlertCircle className="size-3.5 text-amber-500/70" />
              {failures.length} mint{failures.length === 1 ? "" : "s"} skipped (on-chain enrichment failed)
            </div>
            <ul className="space-y-0.5">
              {failures.map((fail) => (
                <li
                  key={fail.mint}
                  className="flex items-baseline gap-2 text-[11px] text-zinc-600"
                >
                  <span className="shrink-0 font-mono text-zinc-500">
                    {fail.mint.slice(0, 4)}…{fail.mint.slice(-4)}
                  </span>
                  <span className="truncate">{fail.reason}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
