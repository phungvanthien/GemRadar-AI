"use client";

import { Flame } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatPercent } from "@/lib/utils";
import type { MarketToken } from "@/lib/types";

interface RightSidebarProps {
  trending: MarketToken[];
  loading: boolean;
}

export function RightSidebar({ trending, loading }: RightSidebarProps) {
  if (loading) {
    return (
      <aside className="p-4 space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </aside>
    );
  }

  return (
    <aside className="flex h-full flex-col p-4 lg:max-h-[calc(100vh-4rem)]">
      <Card className="flex flex-1 flex-col border-orange-500/10 overflow-hidden">
        <CardHeader className="border-b border-zinc-800/80 pb-3">
          <CardTitle className="flex items-center gap-2 text-orange-400">
            <Flame className="size-4" />
            Trending Tokens
          </CardTitle>
          <p className="text-xs text-zinc-500">By 24h volume</p>
        </CardHeader>
        <CardContent className="flex-1 p-0">
          <ScrollArea className="h-[min(70vh,600px)]">
            <ul className="divide-y divide-zinc-800/60">
              {trending.map((token, idx) => (
                <li
                  key={token.id}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-zinc-800/30"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-zinc-800 text-xs font-bold text-zinc-400">
                    {idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-zinc-100">{token.symbol}</span>
                      <Badge variant="muted" className="text-[10px]">
                        #{token.rank}
                      </Badge>
                    </div>
                    <p className="truncate text-xs text-zinc-500">{token.name}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-medium">{formatCurrency(token.price, true)}</p>
                    <p
                      className={`text-xs ${
                        token.percentChange24h >= 0 ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {formatPercent(token.percentChange24h)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </ScrollArea>
        </CardContent>
      </Card>
    </aside>
  );
}
