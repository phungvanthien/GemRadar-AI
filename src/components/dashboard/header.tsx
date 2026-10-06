"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Crosshair, Settings, LineChart, Wallet } from "lucide-react";
import { useLanguage } from "@/lib/i18n/context";

export function Header() {
  const pathname = usePathname();
  const { t } = useLanguage();
  const isSettings = pathname === "/settings";
  const isPortfolio = pathname === "/portfolio";
  const isMandate = pathname === "/mandate";

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-xl">
      <div className="flex h-16 items-center justify-between px-4 lg:px-6">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-amber-500/20 transition-transform group-hover:scale-105">
            <Crosshair className="size-5 text-black" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">
              <span className="bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
                GemRadar
              </span>{" "}
              <span className="text-zinc-100">AI</span>
            </h1>
            <p className="hidden text-xs text-zinc-500 sm:block">
              {t("common.cryptoIntelligence") || "Crypto intelligence · Hidden gem scanner"}
            </p>
          </div>
        </Link>

        <div className="flex items-center gap-3">
          {/* Live indicator */}
          <div className="flex items-center gap-2">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
            <span className="hidden text-xs font-medium text-zinc-400 sm:block">{t("common.live") || "Live"}</span>
          </div>

          {/* Mandate nav link */}
          <Link
            href="/mandate"
            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
              isMandate
                ? "bg-amber-500/15 text-amber-400"
                : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            }`}
          >
            <Wallet className={`size-4 ${isMandate ? "text-amber-400" : ""}`} />
            <span className="hidden sm:block">{t("nav.mandate") || "Mandate"}</span>
          </Link>

          {/* Portfolio nav link */}
          <Link
            href="/portfolio"
            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
              isPortfolio
                ? "bg-amber-500/15 text-amber-400"
                : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            }`}
          >
            <LineChart className={`size-4 ${isPortfolio ? "text-amber-400" : ""}`} />
            <span className="hidden sm:block">{t("nav.portfolio") || "Portfolio"}</span>
          </Link>

          {/* Settings nav link */}
          <Link
            href={isSettings ? "/" : "/settings"}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
              isSettings
                ? "bg-amber-500/15 text-amber-400"
                : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            }`}
          >
            <Settings className={`size-4 ${isSettings ? "text-amber-400" : ""}`} />
            <span className="hidden sm:block">{t("nav.settings") || "Settings"}</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
