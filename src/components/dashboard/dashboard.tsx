"use client";

import { useCallback, useEffect, useState } from "react";
import { Header } from "@/components/dashboard/header";
import { LeftSidebar } from "@/components/dashboard/left-sidebar";
import { RightSidebar } from "@/components/dashboard/right-sidebar";
import { LiveFeed } from "@/components/dashboard/live-feed";
import { ChatPanel } from "@/components/dashboard/chat-panel";
import type { MarketOverview } from "@/lib/types";

export function Dashboard() {
  const [market, setMarket] = useState<MarketOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const loadMarket = useCallback(async () => {
    try {
      const res = await fetch("/api/market");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load market");
      setMarket(data);
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Market data unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMarket();
    const interval = setInterval(loadMarket, 120_000);
    return () => clearInterval(interval);
  }, [loadMarket]);

  return (
    <div className="flex min-h-screen flex-col bg-[#07070a]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-amber-900/10 via-transparent to-transparent" />
      <Header />
      <div className="relative flex flex-1 flex-col lg:flex-row">
        <div className="w-full border-b border-zinc-800/80 lg:w-72 lg:shrink-0 lg:border-b-0 lg:border-r">
          <LeftSidebar data={market} loading={loading} error={error} />
        </div>
        <div className="min-h-[50vh] flex-1 lg:min-h-0">
          <ChatPanel />
        </div>
        <div className="w-full border-t border-zinc-800/80 lg:w-80 lg:shrink-0 lg:border-t-0 lg:border-l">
          <RightSidebar trending={market?.trending ?? []} loading={loading} />
        </div>
        <div className="w-full border-t border-zinc-800/80 lg:w-80 lg:shrink-0 lg:border-t-0 lg:border-l">
          <LiveFeed />
        </div>
      </div>
    </div>
  );
}
