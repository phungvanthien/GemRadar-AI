import { Header } from "@/components/dashboard/header";
import { PortfolioPanel } from "@/components/dashboard/portfolio-panel-1";
import { BotActivityPanel } from "@/components/dashboard/bot-activity-panel";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Portfolio | GemRadar AI",
  description:
    "Trade P&L, transaction history and wallet tracking in SOL",
};

export default function PortfolioPage() {
  return (
    <div className="flex min-h-screen flex-col bg-[#07070a]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-amber-900/10 via-transparent to-transparent" />
      <Header />
      <div className="relative flex flex-1 flex-col lg:flex-row">
        <div className="flex-1 overflow-auto">
          <PortfolioPanel />
        </div>
        <div className="w-full border-t border-zinc-800/80 lg:w-80 lg:shrink-0 lg:border-t-0 lg:border-l h-[calc(100vh-4rem)] lg:sticky top-16">
          <BotActivityPanel />
        </div>
      </div>
    </div>
  );
}
