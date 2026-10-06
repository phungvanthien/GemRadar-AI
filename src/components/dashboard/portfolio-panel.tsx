"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  Trophy,
  Activity,
  RefreshCw,
  Trash2,
  AlertTriangle,
  Eye,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/i18n/context";

import { StatCard } from "./portfolio/StatCard";
import { PnlChart } from "./portfolio/PnlChart";
import { GemRow } from "./portfolio/GemRow";

interface TradeLeg {
  time: string;
  kind: "buy" | "sell";
  pct: number;
  priceUsd: number;
  solFlow: number;
  tokenAmount: number;
  reason: string | null;
  txSig: string | null;
  dryRun: boolean;
  realizedPnlSol: number | null;
}

interface GemSummary {
  id: string;
  mint: string;
  symbol: string;
  status: "open" | "closed";
  mode: "dry-run" | "live";
  entryTime: string;
  closedTime: string | null;
  closedReason: string | null;
  entryPriceUsd: number;
  entrySol: number;
  entryPriceSol: number | null;
  currentPriceSol: number | null;
  soldPct: number;
  realizedPnlSol: number;
  unrealizedPnlSol: number;
  totalPnlSol: number;
  legs: TradeLeg[];
}

interface SeriesPoint {
  time: string;
  cumulativePnlSol: number;
}

interface PortfolioData {
  effectiveMode: "live" | "dry-run";
  isWorkerActive: boolean;
  solPriceUsd: number | null;
  wallet: { address: string | null; balanceSol: number | null };
  totals: {
    realizedPnlSol: number;
    unrealizedPnlSol: number;
    totalPnlSol: number;
    openCount: number;
    closedCount: number;
    winRate: number | null;
  };
  series: SeriesPoint[];
  gems: GemSummary[];
  updatedAt: string;
}

interface WatchlistItem {
  mint: string;
  symbol: string;
  name: string;
  scoreTotal: number;
  scoreCoverage: number;
  scoreDelta: number | null;
  peakScoreTotal: number;
  aiGemScore: number | null;
  aiRiskScore: number | null;
  lastCheckedAt: string | null;
  lastSkipReason: string | null;
  addedAt: string;
}

interface WatchlistData {
  items: WatchlistItem[];
  minGemScoreToTrigger: number;
  watchScoreFloor: number;
  maxSize: number;
}

function fmtSol(v: number, digits = 4): string {
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)} SOL`;
}

function fmtUsd(sol: number, solPriceUsd: number | null): string | null {
  if (solPriceUsd == null) return null;
  const usd = sol * solPriceUsd;
  const sign = usd > 0 ? "+" : "";
  return `${sign}$${Math.abs(usd).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })}`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortMint(mint: string): string {
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

function pnlColor(v: number): string {
  if (v > 0) return "text-emerald-400";
  if (v < 0) return "text-red-400";
  return "text-zinc-400";
}

export function PortfolioPanel() {
  const { t } = useLanguage();
  const [data, setData] = useState<PortfolioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [abandoningId, setAbandoningId] = useState<string | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistData | null>(null);

  const load = useCallback(async () => {
    try {
      const [portRes, watchRes] = await Promise.all([
        fetch("/api/portfolio"),
        fetch("/api/watchlist"),
      ]);
      const json = await portRes.json();
      if (!portRes.ok) throw new Error(json.error ?? "Failed to load portfolio");
      setData(json);
      if (watchRes.ok) {
        setWatchlist(await watchRes.json());
      }
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Portfolio unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  const abandonPosition = useCallback(
    async (id: string) => {
      setAbandoningId(id);
      try {
        const res = await fetch("/api/portfolio?action=abandon", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ positionId: id }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Ghi mất vị thế thất bại");
        setError(undefined);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Ghi mất vị thế thất bại");
      } finally {
        setAbandoningId(null);
      }
    },
    [load],
  );

  const resetPortfolio = useCallback(async () => {
    setResetting(true);
    try {
      const res = await fetch("/api/portfolio", { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Reset thất bại");
      setError(undefined);
      setConfirming(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset thất bại");
    } finally {
      setResetting(false);
    }
  }, [load]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [load]);

  const totals = data?.totals;
  const solPriceUsd = data?.solPriceUsd ?? null;

  return (
    <main className="relative mx-auto w-full max-w-6xl flex-1 px-4 py-6 lg:px-6">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-zinc-100">{t("portfolio.title") || "Portfolio"}</h2>
            {data && (
              data.effectiveMode === "live" ? (
                data.isWorkerActive ? (
                  <Badge variant="default" className="bg-emerald-500/20 text-emerald-400 border-emerald-500/50 animate-pulse">
                    {t("portfolio.statusLiveActive") || "🟢 Đang săn Gems (Live)"}
                  </Badge>
                ) : (
                  <Badge variant="muted" className="text-amber-400 border-amber-500/50 bg-amber-500/10">
                    {t("portfolio.statusLiveWaiting") || "🟡 Đang đợi Worker quét dữ liệu..."}
                  </Badge>
                )
              ) : (
                <Badge variant="muted" className="text-zinc-400 border-zinc-500/50 bg-zinc-500/10">
                  {t("portfolio.statusDryRun") || "⚪ Đang mô phỏng (Dry-run)"}
                </Badge>
              )
            )}
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            {t("portfolio.description") || "Lợi nhuận mua bán, lịch sử giao dịch và theo dõi ví theo SOL"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            {t("common.refresh") || "Làm mới"}
          </button>
          <button
            onClick={() => setConfirming(true)}
            disabled={resetting}
            className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-2 text-xs font-medium text-red-400/80 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
          >
            <Trash2 className="size-4" />
            {t("common.resetSim") || "Reset mô phỏng"}
          </button>
        </div>
      </div>

      {confirming && (
        <Card className="mb-6 border-red-500/40 bg-red-950/20">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-400" />
              <div>
                <p className="text-sm font-medium text-red-300">
                  {t("portfolio.deleteAllSim") || "Xóa toàn bộ lịch sử mô phỏng?"}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={resetPortfolio}
                disabled={resetting}
                className="flex items-center gap-1.5 rounded-lg bg-red-500/90 px-3 py-2 text-xs font-semibold text-white"
              >
                {resetting ? <RefreshCw className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                {t("common.deleteAll") || "Xóa tất cả"}
              </button>
              <button
                onClick={() => setConfirming(false)}
                disabled={resetting}
                className="rounded-lg px-3 py-2 text-xs font-medium text-zinc-400"
              >
                {t("common.cancel") || "Hủy"}
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="mb-6 border-red-500/30">
          <CardContent className="p-4 text-sm text-red-400">{error}</CardContent>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={<Wallet className="size-3.5" />}
          label={t("portfolio.walletBalance") || "Số dư ví"}
          value={data?.wallet.balanceSol != null ? `${data.wallet.balanceSol.toFixed(4)} SOL` : "—"}
          sub={data?.wallet.balanceSol != null && solPriceUsd != null ? `$${(data.wallet.balanceSol * solPriceUsd).toLocaleString("en-US", { maximumFractionDigits: 2 })}` : undefined}
        />
        <StatCard
          icon={(totals?.totalPnlSol ?? 0) >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
          label={t("portfolio.totalProfit") || "Tổng lợi nhuận"}
          value={totals ? fmtSol(totals.totalPnlSol) : "—"}
          sub={totals ? fmtUsd(totals.totalPnlSol, solPriceUsd) : null}
          valueClass={totals ? pnlColor(totals.totalPnlSol) : undefined}
        />
        <StatCard
          icon={<Activity className="size-3.5" />}
          label={t("portfolio.openPositions") || "Vị thế đang mở"}
          value={totals ? `${totals.openCount}` : "—"}
          sub={totals ? `${totals.closedCount} đã đóng` : null}
        />
        <StatCard
          icon={<Trophy className="size-3.5" />}
          label={t("portfolio.winRate") || "Tỷ lệ thắng"}
          value={totals?.winRate != null ? `${totals.winRate.toFixed(0)}%` : "—"}
          sub={totals ? `LN chưa chốt ${fmtSol(totals.unrealizedPnlSol, 3)}` : null}
        />
      </div>

      <Card className="mb-6 border-orange-500/10">
        <CardHeader className="border-b border-zinc-800/80 pb-3">
          <CardTitle className="flex items-center gap-2 text-orange-400">
            <TrendingUp className="size-4" />
            {t("portfolio.walletPnlAcc") || "Lợi nhuận ví tích lũy (SOL)"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <PnlChart series={data?.series ?? []} />
        </CardContent>
      </Card>

      <Card className="mb-6 border-amber-500/15 overflow-hidden">
        <CardHeader className="border-b border-zinc-800/80 pb-3">
          <CardTitle className="flex items-center gap-2 text-amber-400/90">
            <Eye className="size-4" />
            {t("portfolio.watchlistTitle") || "Gems theo dõi"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!watchlist || watchlist.items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-zinc-600">
              {t("portfolio.watchlistEmpty") || "Chưa có gem nào trong danh sách theo dõi."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-xs text-zinc-500">
                    <th className="py-2 pl-4 pr-2 text-left font-medium">Gem</th>
                    <th className="px-2 py-2 text-right font-medium">GemScore</th>
                    <th className="px-2 py-2 text-right font-medium">Biến động</th>
                    <th className="px-2 py-2 text-right font-medium">Đỉnh</th>
                    <th className="px-2 py-2 text-right font-medium">Coverage</th>
                    <th className="py-2 pl-2 pr-4 text-right font-medium">Kiểm tra lúc</th>
                  </tr>
                </thead>
                <tbody>
                  {watchlist.items.map((w) => (
                    <tr key={w.mint} className="border-t border-zinc-800/60 hover:bg-zinc-800/20">
                      <td className="py-3 pl-4 pr-2">
                        <div className="font-semibold text-zinc-100">{w.symbol || "???"}</div>
                        <span className="font-mono text-[11px] text-zinc-600">{shortMint(w.mint)}</span>
                      </td>
                      <td className="px-2 py-3 text-right tabular-nums font-semibold text-amber-400/90">
                        {w.scoreTotal}/100
                      </td>
                      <td className={cn("px-2 py-3 text-right tabular-nums text-xs", w.scoreDelta == null ? "text-zinc-600" : w.scoreDelta > 0 ? "text-emerald-400" : "text-red-400")}>
                        {w.scoreDelta == null ? "—" : `${w.scoreDelta > 0 ? "+" : ""}${w.scoreDelta.toFixed(0)}`}
                      </td>
                      <td className="px-2 py-3 text-right tabular-nums text-xs text-zinc-400">{w.peakScoreTotal}</td>
                      <td className="px-2 py-3 text-right tabular-nums text-xs text-zinc-400">{(w.scoreCoverage * 100).toFixed(0)}%</td>
                      <td className="py-3 pl-2 pr-4 text-right text-xs text-zinc-500 tabular-nums">{w.lastCheckedAt ? fmtTime(w.lastCheckedAt) : fmtTime(w.addedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-orange-500/10 overflow-hidden">
        <CardHeader className="border-b border-zinc-800/80 pb-3">
          <CardTitle className="text-zinc-200">{t("portfolio.tradedGems") || "Gems đã giao dịch"}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading && !data ? (
            <p className="px-4 py-8 text-center text-sm text-zinc-600">Đang tải…</p>
          ) : data && data.gems.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-zinc-600">Chưa có gem nào được giao dịch.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-xs text-zinc-500">
                    <th className="py-2 pl-4 pr-2 text-left font-medium">Gem</th>
                    <th className="px-2 py-2 text-right font-medium">Mua lúc</th>
                    <th className="px-2 py-2 text-right font-medium">Vốn vào</th>
                    <th className="px-2 py-2 text-right font-medium">Đã bán</th>
                    <th className="py-2 pl-2 pr-4 text-right font-medium">Tổng P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.gems.map((gem) => (
                    <GemRow
                      key={gem.id}
                      gem={gem}
                      solPriceUsd={solPriceUsd}
                      onAbandon={abandonPosition}
                      abandoning={abandoningId === gem.id}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {data && (
        <p className="mt-4 text-center text-[11px] text-zinc-600">
          Cập nhật {fmtTime(data.updatedAt)}
          {data.wallet.address && ` · Ví ${shortMint(data.wallet.address)}`}
        </p>
      )}
    </main>
  );
}