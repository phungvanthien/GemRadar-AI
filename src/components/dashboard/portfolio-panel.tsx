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
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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
        Chưa có lệnh bán nào để vẽ biểu đồ
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
}: {
  gem: GemSummary;
  solPriceUsd: number | null;
}) {
  const [open, setOpen] = useState(false);
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
                  {gem.status === "open" ? "Đang giữ" : "Đã đóng"}
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
              (thực {fmtSol(gem.realizedPnlSol, 3)})
            </div>
          )}
        </td>
      </tr>
      {open && (
        <tr className="border-t border-zinc-800/40 bg-zinc-950/40">
          <td colSpan={5} className="px-4 py-3">
            <div className="space-y-1.5">
              {gem.legs.length === 0 && (
                <p className="text-xs text-zinc-600">Không có lệnh nào.</p>
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
                      {leg.kind === "buy" ? "Mua" : `Bán ${leg.pct.toFixed(0)}%`}
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
  const [data, setData] = useState<PortfolioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/portfolio");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load portfolio");
      setData(json);
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Portfolio unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

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
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-zinc-100">Thống kê danh mục Gems</h2>
          <p className="text-sm text-zinc-500">
            Lợi nhuận mua bán, lịch sử giao dịch và theo dõi ví theo SOL
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            Làm mới
          </button>
          <button
            onClick={() => setConfirming(true)}
            disabled={resetting}
            className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-2 text-xs font-medium text-red-400/80 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
          >
            <Trash2 className="size-4" />
            Reset mô phỏng
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
                  Xóa toàn bộ lịch sử mô phỏng?
                </p>
                <p className="text-xs text-zinc-400">
                  Mọi vị thế và lệnh giao dịch sẽ bị xóa. Hành động này không thể hoàn tác.
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
                Xóa hết
              </button>
              <button
                onClick={() => setConfirming(false)}
                disabled={resetting}
                className="rounded-lg px-3 py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
              >
                Hủy
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
          label="Số dư ví"
          value={
            data?.wallet.balanceSol != null
              ? `${data.wallet.balanceSol.toFixed(4)} SOL`
              : "—"
          }
          sub={
            data?.wallet.balanceSol != null && solPriceUsd != null
              ? `$${(data.wallet.balanceSol * solPriceUsd).toLocaleString("en-US", { maximumFractionDigits: 2 })}`
              : data?.wallet.address
                ? "RPC không khả dụng"
                : "Chưa cấu hình ví"
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
          label="Tổng lợi nhuận"
          value={totals ? fmtSol(totals.totalPnlSol) : "—"}
          sub={totals ? fmtUsd(totals.totalPnlSol, solPriceUsd) : null}
          valueClass={totals ? pnlColor(totals.totalPnlSol) : undefined}
        />
        <StatCard
          icon={<Activity className="size-3.5" />}
          label="Vị thế"
          value={totals ? `${totals.openCount} mở` : "—"}
          sub={totals ? `${totals.closedCount} đã đóng` : null}
        />
        <StatCard
          icon={<Trophy className="size-3.5" />}
          label="Tỷ lệ thắng"
          value={totals?.winRate != null ? `${totals.winRate.toFixed(0)}%` : "—"}
          sub={totals ? `LN chưa chốt ${fmtSol(totals.unrealizedPnlSol, 3)}` : null}
        />
      </div>

      {/* Chart */}
      <Card className="mb-6 border-orange-500/10">
        <CardHeader className="border-b border-zinc-800/80 pb-3">
          <CardTitle className="flex items-center gap-2 text-orange-400">
            <TrendingUp className="size-4" />
            Lợi nhuận ví tích lũy (SOL)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <PnlChart series={data?.series ?? []} />
        </CardContent>
      </Card>

      {/* Gems table */}
      <Card className="border-orange-500/10 overflow-hidden">
        <CardHeader className="border-b border-zinc-800/80 pb-3">
          <CardTitle className="text-zinc-200">Gems đã giao dịch</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading && !data ? (
            <p className="px-4 py-8 text-center text-sm text-zinc-600">Đang tải…</p>
          ) : data && data.gems.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-zinc-600">
              Chưa có gem nào được giao dịch.
            </p>
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
                    <GemRow key={gem.id} gem={gem} solPriceUsd={solPriceUsd} />
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
