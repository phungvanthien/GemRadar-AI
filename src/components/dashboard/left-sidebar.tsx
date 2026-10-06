"use client";

import { Bitcoin, TrendingDown, TrendingUp, Gauge } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { formatCurrency, formatPercent } from "@/lib/utils";
import type { MarketOverview } from "@/lib/types";
import { useLanguage } from "@/lib/i18n/context";

interface LeftSidebarProps {
  data: MarketOverview | null;
  loading: boolean;
  error?: string;
}

function fearGreedColor(value: number): "success" | "danger" | "default" | "muted" {
  if (value >= 75) return "danger";
  if (value >= 55) return "default";
  if (value >= 45) return "muted";
  if (value >= 25) return "success";
  return "success";
}

function TokenRow({
  symbol,
  name,
  price,
  change,
}: {
  symbol: string;
  name: string;
  price: number;
  change: number;
}) {
  const positive = change >= 0;
  return (
    <div className="flex items-center justify-between gap-2 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-zinc-100">{symbol}</p>
        <p className="truncate text-xs text-zinc-500">{name}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-xs text-zinc-400">{formatCurrency(price, true)}</p>
        <p className={`text-xs font-medium ${positive ? "text-emerald-400" : "text-red-400"}`}>
          {formatPercent(change)}
        </p>
      </div>
    </div>
  );
}

export function LeftSidebar({ data, loading, error }: LeftSidebarProps) {
  const { t } = useLanguage();

  if (loading) {
    return (
      <aside className="flex flex-col gap-4 p-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-28 w-full" />
      </aside>
    );
  }

  if (error) {
    return (
      <aside className="p-4">
        <Card className="border-red-900/50 bg-red-950/20">
          <CardContent className="p-4 text-sm text-red-400">{error}</CardContent>
        </Card>
      </aside>
    );
  }

  if (!data) return null;

  return (
    <aside className="flex h-full flex-col gap-4 overflow-y-auto p-4 lg:max-h-[calc(100vh-4rem)]">
      <Card className="border-amber-500/20 bg-gradient-to-br from-zinc-900 to-zinc-950">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-amber-400">
            <Bitcoin className="size-4" />
            BTC Dominance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold tracking-tight text-zinc-50">
            {data.btcDominance.toFixed(2)}%
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Total cap {formatCurrency(data.totalMarketCap, true)}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-emerald-400">
            <TrendingUp className="size-4" />
            {t("sidebar.topGainers") || "Top Gainers"}
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-zinc-800/80">
          {data.topGainers.map((t) => (
            <TokenRow
              key={t.id}
              symbol={t.symbol}
              name={t.name}
              price={t.price}
              change={t.percentChange24h}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-red-400">
            <TrendingDown className="size-4" />
            {t("sidebar.topLosers") || "Top Losers"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.topLosers.map((t) => (
            <TokenRow
              key={t.id}
              symbol={t.symbol}
              name={t.name}
              price={t.price}
              change={t.percentChange24h}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Gauge className="size-4 text-violet-400" />
            {t("sidebar.fearGreed") || "Fear & Greed"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end justify-between">
            <p className="text-4xl font-bold">{data.fearGreedIndex}</p>
            <Badge variant={fearGreedColor(data.fearGreedIndex)}>{data.fearGreedLabel}</Badge>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-red-500 via-amber-500 to-emerald-500 transition-all"
              style={{ width: `${data.fearGreedIndex}%` }}
            />
          </div>
        </CardContent>
      </Card>

      <Separator className="opacity-50" />
      <p className="text-center text-[10px] text-zinc-600">
        {t("sidebar.updated") || "Updated"} {new Date(data.updatedAt).toLocaleTimeString()}
      </p>
    </aside>
  );
}
