"use client";

import { useState } from "react";
import { LiveFeed } from "@/components/dashboard/live-feed";
import { LiveScan } from "@/components/dashboard/live-scan";
import { useLanguage } from "@/lib/i18n/context";

export function BotActivityPanel() {
  const { t } = useLanguage();
  const [activeRightTab, setActiveRightTab] = useState<"feed" | "scan">("scan");

  return (
    <div className="flex h-full flex-col w-full">
      <div className="flex border-b border-zinc-800/80">
        <button
          onClick={() => setActiveRightTab("scan")}
          className={`flex-1 py-3 text-xs font-medium transition-colors ${
            activeRightTab === "scan"
              ? "bg-blue-500/10 text-blue-400 border-b-2 border-blue-500"
              : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
          }`}
        >
          {t("activity.botScanner") || "Bot Scanner"}
        </button>
        <button
          onClick={() => setActiveRightTab("feed")}
          className={`flex-1 py-3 text-xs font-medium transition-colors ${
            activeRightTab === "feed"
              ? "bg-orange-500/10 text-orange-400 border-b-2 border-orange-500"
              : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
          }`}
        >
          {t("activity.liveFeed") || "Live Feed"}
        </button>
      </div>
      <div className="flex-1 overflow-hidden min-h-0">
        {activeRightTab === "scan" ? <LiveScan /> : <LiveFeed />}
      </div>
    </div>
  );
}
