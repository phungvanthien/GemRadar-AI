"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  Trophy,
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Trash2,
  AlertTriangle,
  Eye,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/i18n/context";

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

function fmtPrice(v: number): string {
  if (v === 0) return "—";
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: v < 1 ? 8 : 2 })}`;
}

// Price per token denominated in SOL. These are tiny (e.g. 1.2e-6 SOL), so use
// scientific notation below a threshold and fixed decimals otherwise.
function fmtPriceSol(v: number): string {
  if (!(v > 0)) return "—";
  const n = v < 1e-4 ? v.toExponential(3) : v.toFixed(8);
  return `${n} SOL`;
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

// Cumulative realized-P&L line chart, inline SVG. Draws the SOL curve over time
// with a zero baseline so profit/loss crossing is readable.
function PnlChart({ series }: { series: SeriesPoint[] }) {
  const { t } = useLanguage();
  const W = 720;
  const H = 220;
  const PAD = { top: 16, right: 16, bottom: 24, left: 48 };

  const geom = useMemo(() => {
    if (series.length === 0) return null;
    const pts = series.map((p, i) => ({ x: i, y: p.cumulativePnlSol }));
    // Always include 0 in the vertical range so the baseline is meaningful.
    const ys = [...pts.map((p) => p.y), 0];
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanY = maxY - minY || 1;
    const n = pts.length;

    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;

    const sx = (i: number) =>
      PAD.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const sy = (y: number) =>
      PAD.top + plotH - ((y - minY) / spanY) * plotH;

    const line = pts
      .map((p, i) => `${i === 0 ? "M" : "L"}${sx(i).toFixed(1)},${sy(p.y).toFixed(1)}`)
      .join(" ");
    const area =
      `M${sx(0).toFixed(1)},${sy(0).toFixed(1)} ` +
      pts.map((p, i) => `L${sx(i).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ") +
      ` L${sx(n - 1).toFixed(1)},${sy(0).toFixed(1)} Z`;

    const zeroY = sy(0);
    const last = pts[n - 1];
    return {
      line,
      area,
      zeroY,
      minY,
      maxY,
      lastX: sx(n - 1),
      lastY: sy(last.y),
      lastVal: last.y,
    };
  }, [series]);

  if (!geom) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-zinc-600">
        {t("portfolio.noSellOrders") || "Chưa có lệnh bán nào để vẽ biểu đồ"}
      </div>
    );
  }

  const positive = geom.lastVal >= 0;
  const stroke = positive ? "#34d399" : "#f87171";
  const fillId = positive ? "pnlFillPos" : "pnlFillNeg";

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-[220px] w-full"
      role="img"
      aria-label="Biểu đồ lợi nhuận ví theo SOL"
    >
      <defs>
        <linearGradient id="pnlFillPos" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#34d399" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="pnlFillNeg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f87171" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#f87171" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* zero baseline */}
      <line
        x1={PAD.left}
        x2={W - PAD.right}
        y1={geom.zeroY}
        y2={geom.zeroY}
        stroke="#52525b"
        strokeWidth="1"
        strokeDasharray="4 4"
      />
      <text x={PAD.left - 8} y={geom.zeroY + 3} textAnchor="end" className="fill-zinc-600 text-[10px]">
        0
      </text>
      <text x={PAD.left - 8} y={PAD.top + 6} textAnchor="end" className="fill-zinc-600 text-[10px]">
        {geom.maxY.toFixed(2)}
      </text>
      <text
        x={PAD.left - 8}
        y={H - PAD.bottom}
        textAnchor="end"
        className="fill-zinc-600 text-[10px]"
      >
        {geom.minY.toFixed(2)}
      </text>

      <path d={geom.area} fill={`url(#${fillId})`} />
      <path d={geom.line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" />
      <circle cx={geom.lastX} cy={geom.lastY} r="3.5" fill={stroke} />
    </svg>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  valueClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string | null;
  valueClass?: string;
}) {
  return (
    <Card className="border-orange-500/10">
      <CardContent className="flex flex-col gap-1 p-4">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          {icon}
          {label}
        </div>
        <div className={cn("text-xl font-bold tabular-nums", valueClass)}>{value}</div>
        {sub && <div className="text-xs text-zinc-500 tabular-nums">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function GemRow({
  gem,
  solPriceUsd,
  onAbandon,
  abandoning,
}: {
  gem: GemSummary;
  solPriceUsd: number | null;
  onAbandon: (id: string) => void;
  abandoning: boolean;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const usd = fmtUsd(gem.totalPnlSol, solPriceUsd);

  return (
    <>
      <tr
        className="cursor-pointer border-t border-zinc-800/60 transition-colors hover:bg-zinc-800/30"
        onClick={() => setOpen((o) => !o)}
      >
        <td className="py-3 pl-4 pr-2">
          <div className="flex items-center gap-2">
            {open ? (
              <ChevronDown className="size-4 shrink-0 text-zinc-500" />
            ) : (
              <ChevronRight className="size-4 shrink-0 text-zinc-500" />
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-zinc-100">{gem.symbol || "???"}</span>
                <Badge
                  variant={gem.status === "open" ? "default" : "success"}
                  className="text-[10px]"
                >
                  {gem.status === "open" ? (t("portfolio.holding") || "Đang giữ") : (t("portfolio.closed") || "Đã đóng")}
                </Badge>
                {gem.mode === "dry-run" && (
                  <Badge variant="default" className="text-[10px] opacity-70">
                    dry-run
                  </Badge>
                )}
              </div>
              <span className="font-mono text-[11px] text-zinc-600">{shortMint(gem.mint)}</span>
            </div>
          </div>
        </td>
        <td className="px-2 py-3 text-right text-xs text-zinc-400 tabular-nums">
          {fmtTime(gem.entryTime)}
        </td>
        <td className="px-2 py-3 text-right text-xs text-zinc-400 tabular-nums">
          {gem.entrySol.toFixed(3)} SOL
        </td>
        <td className="px-2 py-3 text-right text-xs text-zinc-400 tabular-nums">
          {gem.soldPct.toFixed(0)}%
        </td>
        <td className="py-3 pl-2 pr-4 text-right">
          <div className={cn("font-semibold tabular-nums", pnlColor(gem.totalPnlSol))}>
            {fmtSol(gem.totalPnlSol)}
          </div>
          {usd && <div className={cn("text-[11px] tabular-nums", pnlColor(gem.totalPnlSol))}>{usd}</div>}
          {gem.status === "open" && gem.unrealizedPnlSol !== 0 && (
            <div className="text-[10px] text-zinc-600">
              ({t("portfolio.realized") || "thực"} {fmtSol(gem.realizedPnlSol, 3)})
            </div>
          )}
        </td>
      </tr>
      {open && (
        <tr className="border-t border-zinc-800/40 bg-zinc-950/40">
          <td colSpan={5} className="px-4 py-3">
            {gem.status === "open" && (
              <div className="mb-3 flex items-center justify-between rounded-lg border border-amber-500/20 bg-amber-950/10 px-3 py-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400/80" />
                  <p className="text-xs text-zinc-400">
                    {t("portfolio.writeOffDesc") ||
                      "Token bị rugpull và không bán được? Ghi mất vị thế để giải phóng slot và vốn cho lệnh mới."}
                  </p>
                </div>
                {confirmAbandon ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onAbandon(gem.id);
                        setConfirmAbandon(false);
                      }}
                      disabled={abandoning}
                      className="flex items-center gap-1.5 rounded-lg bg-red-500/90 px-2.5 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-red-500 disabled:opacity-50"
                    >
                      {abandoning ? (
                        <RefreshCw className="size-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="size-3.5" />
                      )}
                      {t("portfolio.writeOff") || "Write-off"}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmAbandon(false);
                      }}
                      disabled={abandoning}
                      className="rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
                    >
                      {t("common.cancel") || "Cancel"}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmAbandon(true);
                    }}
                    disabled={abandoning}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-red-500/30 px-2.5 py-1.5 text-[11px] font-medium text-red-400/80 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                  >
                    <AlertTriangle className="size-3.5" />
                    {t("portfolio.writeOff") || "Ghi mất (rugpull)"}
                  </button>
                )}
              </div>
            )}
            {gem.status === "open" && gem.entryPriceSol != null && (
              <div className="mb-3 grid grid-cols-3 gap-2 rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-3 py-2 text-xs">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-zinc-600">
                    {t("portfolio.entryRateSol") || "Giá mua (SOL)"}
                  </div>
                  <div className="font-mono tabular-nums text-zinc-300">
                    {fmtPriceSol(gem.entryPriceSol)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-zinc-600">
                    {t("portfolio.currentRateSol") || "Giá hiện tại (SOL)"}
                  </div>
                  <div className="font-mono tabular-nums text-zinc-300">
                    {gem.currentPriceSol != null ? fmtPriceSol(gem.currentPriceSol) : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-zinc-600">
                    {t("portfolio.rateChange") || "Chênh lệch"}
                  </div>
                  {(() => {
                    if (gem.currentPriceSol == null || gem.entryPriceSol <= 0) {
                      return <div className="font-mono tabular-nums text-zinc-500">—</div>;
                    }
                    const pct = (gem.currentPriceSol / gem.entryPriceSol - 1) * 100;
                    return (
                      <div className={cn("font-mono tabular-nums", pnlColor(pct))}>
                        {pct >= 0 ? "+" : ""}
                        {pct.toFixed(1)}%
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              {gem.legs.length === 0 && (
                <p className="text-xs text-zinc-600">{t("portfolio.noOrders") || "Không có lệnh nào."}</p>
              )}
              {gem.legs.map((leg, i) => (
                <div
                  key={`${leg.time}-${i}`}
                  className="flex items-center gap-3 rounded-lg bg-zinc-900/50 px-3 py-2 text-xs"
                >
                  <span className="flex items-center gap-1.5">
                    {leg.kind === "buy" ? (
                      <ArrowDownRight className="size-3.5 text-sky-400" />
                    ) : (
                      <ArrowUpRight className="size-3.5 text-emerald-400" />
                    )}
                    <span className="font-medium text-zinc-300">
                      {leg.kind === "buy" ? t("portfolio.legBuy") || "Buy" : `${t("portfolio.legSell") || "Sell"} ${leg.pct.toFixed(0)}%`}
                    </span>
                  </span>
                  <span className="text-zinc-500 tabular-nums">{fmtTime(leg.time)}</span>
                  <span className="text-zinc-500 tabular-nums">@ {fmtPrice(leg.priceUsd)}</span>
                  {leg.reason && leg.kind === "sell" && (
                    <span className="text-amber-400/60">{leg.reason}</span>
                  )}
                  <span className="ml-auto flex items-center gap-3 tabular-nums">
                    <span className={leg.solFlow >= 0 ? "text-emerald-400/80" : "text-sky-400/80"}>
                      {leg.solFlow >= 0 ? "+" : ""}
                      {leg.solFlow.toFixed(4)} SOL
                    </span>
                    {leg.realizedPnlSol !== null && (
                      <span className={cn("font-semibold", pnlColor(leg.realizedPnlSol))}>
                        {fmtSol(leg.realizedPnlSol, 4)}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
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
        if (!res.ok) throw new Error(json.error ?? (t("portfolio.writeOffFail") || "Ghi mất vị thế thất bại"));
        setError(undefined);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : (t("portfolio.writeOffFail") || "Ghi mất vị thế thất bại"));
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
      if (!res.ok) throw new Error(json.error ?? (t("portfolio.resetFail") || "Reset thất bại"));
      setError(undefined);
      setConfirming(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : (t("portfolio.resetFail") || "Reset thất bại"));
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
                  <Badge
                    variant="default"
                    className="bg-emerald-500/20 text-emerald-400 border-emerald-500/50 shadow-[0_0_12px_rgba(16,185,129,0.3)] animate-pulse"
                  >
                    {t("portfolio.statusLiveActive") || "🟢 Đang săn Gems (Live) - Sẵn sàng tự động giao dịch"}
                  </Badge>
                ) : (
                  <Badge
                    variant="muted"
                    className="text-amber-400 border-amber-500/50 bg-amber-500/10"
                    title={t("portfolio.statusLiveWaitingTooltip") || "Worker chưa quét dữ liệu gần đây. Hãy đảm bảo bạn đã chạy lệnh npm run trade-worker"}
                  >
                    {t("portfolio.statusLiveWaiting") || "🟡 Sẵn sàng Live - Đang đợi Worker quét dữ liệu..."}
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
                  {t("portfolio.deleteAllSim") || "Delete all simulation history?"}
                </p>
                <p className="text-xs text-zinc-400">
                  {t("portfolio.deleteAllSimDesc") || "All positions and trade orders will be deleted. This action cannot be undone."}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={resetPortfolio}
                disabled={resetting}
                className="flex items-center gap-1.5 rounded-lg bg-red-500/90 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-500 disabled:opacity-50"
              >
                {resetting ? (
                  <RefreshCw className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                {t("common.deleteAll") || "Delete All"}
              </button>
              <button
                onClick={() => setConfirming(false)}
                disabled={resetting}
                className="rounded-lg px-3 py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
              >
                {t("common.cancel") || "Cancel"}
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

      {/* Stat cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={<Wallet className="size-3.5" />}
          label={t("portfolio.walletBalance") || "Số dư ví"}
          value={
            data?.wallet.balanceSol != null
              ? `${data.wallet.balanceSol.toFixed(4)} SOL`
              : "—"
          }
          sub={
            data?.wallet.balanceSol != null && solPriceUsd != null
              ? `$${(data.wallet.balanceSol * solPriceUsd).toLocaleString("en-US", { maximumFractionDigits: 2 })}`
              : data?.wallet.address
                ? t("common.error") || "RPC không khả dụng"
                : t("portfolio.noWalletConfig") || "Chưa cấu hình ví"
          }
        />
        <StatCard
          icon={
            (totals?.totalPnlSol ?? 0) >= 0 ? (
              <TrendingUp className="size-3.5" />
            ) : (
              <TrendingDown className="size-3.5" />
            )
          }
          label={t("portfolio.totalProfit")}
          value={totals ? fmtSol(totals.totalPnlSol) : "—"}
          sub={totals ? fmtUsd(totals.totalPnlSol, solPriceUsd) : null}
          valueClass={totals ? pnlColor(totals.totalPnlSol) : undefined}
        />
        <StatCard
          icon={<Activity className="size-3.5" />}
          label={t("portfolio.openPositions")}
          value={totals ? `${totals.openCount}` : "—"}
          sub={totals ? `${totals.closedCount} đã đóng` : null}
        />
        <StatCard
          icon={<Trophy className="size-3.5" />}
          label={t("portfolio.winRate")}
          value={totals?.winRate != null ? `${totals.winRate.toFixed(0)}%` : "—"}
          sub={totals ? `LN chưa chốt ${fmtSol(totals.unrealizedPnlSol, 3)}` : null}
        />
      </div>

      {/* Chart */}
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

      {/* Watchlist — high scores below buy threshold */}
      <Card className="mb-6 border-amber-500/15 overflow-hidden">
        <CardHeader className="border-b border-zinc-800/80 pb-3">
          <CardTitle className="flex items-center gap-2 text-amber-400/90">
            <Eye className="size-4" />
            {t("portfolio.watchlistTitle") || "Gems theo dõi (chưa đủ điểm mua)"}
          </CardTitle>
          <p className="mt-1 text-xs text-zinc-500">
            {t("portfolio.watchlistDesc") ||
              "Tối đa 30 token — quét lại mỗi giờ bằng tool; điểm tăng tốt → AI phân tích."}
            {watchlist != null && (
              <span className="ml-1 text-zinc-600">
                · {t("portfolio.watchlistBuyThreshold") || "Ngưỡng mua"} ≥{" "}
                {watchlist.minGemScoreToTrigger}/100
              </span>
            )}
          </p>
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
                    <th className="px-2 py-2 text-right font-medium">
                      {t("portfolio.watchlistGemScore") || "GemScore"}
                    </th>
                    <th className="px-2 py-2 text-right font-medium">
                      {t("portfolio.watchlistDelta") || "Biến động"}
                    </th>
                    <th className="px-2 py-2 text-right font-medium">
                      {t("portfolio.watchlistPeak") || "Đỉnh"}
                    </th>
                    <th className="px-2 py-2 text-right font-medium">
                      {t("portfolio.watchlistCoverage") || "Coverage"}
                    </th>
                    <th className="py-2 pl-2 pr-4 text-right font-medium">
                      {t("portfolio.watchlistLastCheck") || "Kiểm tra lúc"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {watchlist.items.map((w) => (
                    <tr
                      key={w.mint}
                      className="border-t border-zinc-800/60 hover:bg-zinc-800/20"
                    >
                      <td className="py-3 pl-4 pr-2">
                        <div className="font-semibold text-zinc-100">{w.symbol || "???"}</div>
                        <span className="font-mono text-[11px] text-zinc-600">{shortMint(w.mint)}</span>
                        {w.aiGemScore != null && (
                          <div className="mt-0.5 text-[10px] text-zinc-500">
                            {t("portfolio.watchlistAiScore") || "AI"}: {w.aiGemScore}/10
                            {w.aiRiskScore != null ? ` · risk ${w.aiRiskScore}/10` : ""}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-3 text-right tabular-nums font-semibold text-amber-400/90">
                        {w.scoreTotal}/100
                      </td>
                      <td
                        className={cn(
                          "px-2 py-3 text-right tabular-nums text-xs",
                          w.scoreDelta == null
                            ? "text-zinc-600"
                            : w.scoreDelta > 0
                              ? "text-emerald-400"
                              : w.scoreDelta < 0
                                ? "text-red-400"
                                : "text-zinc-500",
                        )}
                      >
                        {w.scoreDelta == null
                          ? "—"
                          : `${w.scoreDelta > 0 ? "+" : ""}${w.scoreDelta.toFixed(0)}`}
                      </td>
                      <td className="px-2 py-3 text-right tabular-nums text-xs text-zinc-400">
                        {w.peakScoreTotal}
                      </td>
                      <td className="px-2 py-3 text-right tabular-nums text-xs text-zinc-400">
                        {(w.scoreCoverage * 100).toFixed(0)}%
                      </td>
                      <td className="py-3 pl-2 pr-4 text-right text-xs text-zinc-500 tabular-nums">
                        {w.lastCheckedAt ? fmtTime(w.lastCheckedAt) : fmtTime(w.addedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Gems table */}
      <Card className="border-orange-500/10 overflow-hidden">
        <CardHeader className="border-b border-zinc-800/80 pb-3">
          <CardTitle className="text-zinc-200">{t("portfolio.tradedGems") || "Gems đã giao dịch"}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading && !data ? (
            <p className="px-4 py-8 text-center text-sm text-zinc-600">{t("common.loading") || "Đang tải…"}</p>
          ) : data && data.gems.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-zinc-600">
              {t("portfolio.noGemsTraded") || "Chưa có gem nào được giao dịch."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-xs text-zinc-500">
                    <th className="py-2 pl-4 pr-2 text-left font-medium">Gem</th>
                    <th className="px-2 py-2 text-right font-medium">{t("portfolio.buyTime") || "Mua lúc"}</th>
                    <th className="px-2 py-2 text-right font-medium">{t("portfolio.capitalIn") || "Vốn vào"}</th>
                    <th className="px-2 py-2 text-right font-medium">{t("portfolio.soldPct") || "Đã bán"}</th>
                    <th className="py-2 pl-2 pr-4 text-right font-medium">{t("portfolio.totalPnl") || "Tổng P&L"}</th>
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
          {t("sidebar.updated") || "Cập nhật"} {fmtTime(data.updatedAt)}
          {data.wallet.address && ` · ${t("portfolio.wallet") || "Ví"} ${shortMint(data.wallet.address)}`}
        </p>
      )}
    </main>
  );
}
