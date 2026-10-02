"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Wallet,
  Play,
  Pause,
  Square,
  Save,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ShieldCheck,
  Info,
  TrendingDown,
  Layers,
  Percent,
  Lock,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

// ── Types (mirror the /api/mandate shape) ─────────────────────────────────────

type MandateStatus = "active" | "paused" | "stopped";
type DrawdownBreachAction = "halt" | "halt-and-liquidate";

interface Mandate {
  status: MandateStatus;
  principalSol: number;
  startedAt: string;
  perTradePctOfPrincipal: number;
  reserveSol: number;
  maxOpenPositions: number;
  maxDrawdownPct: number;
  dailyLossLimitPct: number;
  onDrawdownBreach: DrawdownBreachAction;
  updatedAt: string;
}

interface Accounting {
  principalSol: number;
  deployedSol: number;
  availableSol: number;
  realizedPnlSol: number;
  unrealizedPnlSol: number;
  equitySol: number;
  drawdownPct: number;
  perTradeSizeSol: number;
  realizedTodaySol: number;
  openCount: number;
  maxOpenPositions: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtSol(v: number, digits = 3): string {
  return `${v.toFixed(digits)} SOL`;
}

function fmtSigned(v: number, digits = 3): string {
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)} SOL`;
}

function pnlColor(v: number): string {
  if (v > 1e-9) return "text-emerald-400";
  if (v < -1e-9) return "text-red-400";
  return "text-zinc-400";
}

const STATUS_META: Record<
  MandateStatus,
  { label: string; cls: string; dot: string }
> = {
  active: { label: "Đang chạy", cls: "text-emerald-400 bg-emerald-500/15", dot: "bg-emerald-500" },
  paused: { label: "Tạm dừng", cls: "text-amber-400 bg-amber-500/15", dot: "bg-amber-500" },
  stopped: { label: "Đã dừng", cls: "text-zinc-400 bg-zinc-700/40", dot: "bg-zinc-500" },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  sub,
  valueClass = "text-zinc-100",
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`mt-1 font-mono text-lg font-bold ${valueClass}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-zinc-600">{sub}</p>}
    </div>
  );
}

function SliderRow({
  label,
  icon,
  value,
  unit,
  min,
  max,
  step,
  onChange,
  accent = "accent-amber-500",
  hint,
}: {
  label: string;
  icon: React.ReactNode;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  accent?: string;
  hint?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm font-medium text-zinc-300">
          {icon}
          {label}
        </label>
        <span className="rounded-lg bg-amber-500/15 px-2.5 py-1 font-mono text-sm font-bold text-amber-400">
          {value}
          <span className="ml-0.5 text-xs font-normal text-amber-500/70">{unit}</span>
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className={`w-full ${accent}`}
      />
      {hint && <p className="text-xs text-zinc-600">{hint}</p>}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function MandatePanel() {
  const [mandate, setMandate] = useState<Mandate | null>(null);
  const [acct, setAcct] = useState<Accounting | null>(null);
  const [mode, setMode] = useState<"live" | "dry-run" | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const [mRes, pRes] = await Promise.all([
        fetch("/api/mandate", { cache: "no-store" }),
        fetch("/api/portfolio", { cache: "no-store" }),
      ]);
      const mData = await mRes.json();
      if (!mRes.ok) throw new Error(mData.error ?? "Không tải được uỷ thác");
      setMandate(mData.mandate);
      setAcct(mData.accounting);
      if (pRes.ok) {
        const pData = await pRes.json();
        // Derive live/dry-run from whether any open position is live, else wallet.
        const anyLive = (pData.gems ?? []).some(
          (g: { mode: string }) => g.mode === "live",
        );
        setMode(anyLive || pData.wallet?.address ? (anyLive ? "live" : "dry-run") : "dry-run");
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không xác định");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [load]);

  function patch(p: Partial<Mandate>) {
    setMandate((prev) => (prev ? { ...prev, ...p } : prev));
  }

  const flashSaved = useCallback(() => {
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 3000);
  }, []);

  const saveFields = useCallback(
    async (goActive: boolean) => {
      if (!mandate) return;
      setSaving(true);
      setError(null);
      try {
        const body = {
          ...mandate,
          status: goActive ? "active" : mandate.status,
        };
        const res = await fetch("/api/mandate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Lưu thất bại");
        setMandate(data.mandate);
        flashSaved();
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Lỗi không xác định");
      } finally {
        setSaving(false);
      }
    },
    [mandate, flashSaved, load],
  );

  const runAction = useCallback(
    async (action: "pause" | "resume" | "stop", liquidate = false) => {
      setSaving(true);
      setError(null);
      try {
        const res = await fetch(`/api/mandate?action=${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action === "stop" ? { liquidate } : {}),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Thao tác thất bại");
        if (data.liquidationNote) setError(null);
        flashSaved();
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Lỗi không xác định");
      } finally {
        setSaving(false);
        setConfirmStop(false);
      }
    },
    [flashSaved, load],
  );

  if (loading || !mandate || !acct) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
      </div>
    );
  }

  const pnlSinceStart = acct.equitySol - acct.principalSol;
  const status = STATUS_META[mandate.status];
  const drawdownNearLimit =
    acct.drawdownPct <= -(mandate.maxDrawdownPct * 0.8) && acct.drawdownPct < 0;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-8">
      {/* Title + status */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2.5 text-xl font-bold text-zinc-50">
            <Wallet className="size-5 text-amber-400" />
            Uỷ thác vốn săn Gems
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Giao một phần vốn SOL cho bot tự săn gems, với giới hạn rủi ro bạn đặt
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${status.cls}`}
          >
            <span className={`inline-block size-2 rounded-full ${status.dot}`} />
            {status.label}
          </span>
          <button
            type="button"
            onClick={load}
            className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
            title="Làm mới"
          >
            <RefreshCw className="size-4" />
          </button>
        </div>
      </div>

      {mode && (
        <div
          className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-medium ${
            mode === "live"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              : "border-sky-500/30 bg-sky-500/10 text-sky-400"
          }`}
        >
          <ShieldCheck className="size-4 shrink-0" />
          {mode === "live"
            ? "Chế độ LIVE — bot ký giao dịch thật bằng ví server."
            : "Chế độ DRY-RUN — mô phỏng, không ký giao dịch thật."}
        </div>
      )}

      {saved && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
          <CheckCircle2 className="size-4 shrink-0" />
          Đã lưu thành công!
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <AlertCircle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Capital overview — gốc vs lãi tách bạch */}
      <Card className="border-zinc-800/80 bg-zinc-900/50">
        <CardHeader className="pb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-100">
            Tổng quan vốn
          </h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile label="Vốn gốc" value={fmtSol(acct.principalSol)} sub="đã uỷ thác" />
            <StatTile
              label="Đang triển khai"
              value={fmtSol(acct.deployedSol)}
              sub={`${acct.openCount}/${acct.maxOpenPositions} vị thế`}
            />
            <StatTile label="Khả dụng" value={fmtSol(acct.availableSol)} sub="chờ vào lệnh" />
            <StatTile
              label="Equity"
              value={fmtSol(acct.equitySol)}
              sub="gốc + lãi/lỗ"
              valueClass={pnlColor(pnlSinceStart)}
            />
            <StatTile
              label="Lãi/Lỗ"
              value={fmtSigned(pnlSinceStart)}
              sub={`${acct.drawdownPct >= 0 ? "+" : ""}${acct.drawdownPct.toFixed(1)}%`}
              valueClass={pnlColor(pnlSinceStart)}
            />
            <StatTile
              label="Lệnh/kích thước"
              value={fmtSol(acct.perTradeSizeSol)}
              sub="mỗi lần mua"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <StatTile
              label="Đã chốt (tổng)"
              value={fmtSigned(acct.realizedPnlSol)}
              valueClass={pnlColor(acct.realizedPnlSol)}
            />
            <StatTile
              label="Đã chốt (hôm nay)"
              value={fmtSigned(acct.realizedTodaySol)}
              valueClass={pnlColor(acct.realizedTodaySol)}
            />
          </div>

          {drawdownNearLimit && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              <AlertTriangle className="size-3.5 shrink-0" />
              Đang gần ngưỡng cắt lỗ danh mục ({mandate.maxDrawdownPct}%).
            </div>
          )}
        </CardContent>
      </Card>

      {/* Allocation + risk config */}
      <Card className="border-zinc-800/80 bg-zinc-900/50">
        <CardHeader className="pb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-100">
            Phân bổ & giới hạn rủi ro
          </h2>
        </CardHeader>
        <CardContent className="space-y-6">
          <SliderRow
            label="Vốn gốc uỷ thác"
            icon={<Wallet className="size-3.5 text-amber-400" />}
            value={mandate.principalSol}
            unit="SOL"
            min={0.1}
            max={100}
            step={0.1}
            onChange={(v) => patch({ principalSol: v })}
            hint="Tổng SOL bot được phép dùng để săn gems. Chỉ nạp đúng số bạn muốn uỷ thác."
          />
          <SliderRow
            label="% vốn mỗi lệnh"
            icon={<Percent className="size-3.5 text-amber-400" />}
            value={mandate.perTradePctOfPrincipal}
            unit="%"
            min={1}
            max={100}
            step={1}
            onChange={(v) => patch({ perTradePctOfPrincipal: v })}
            hint={`Mỗi vị thế dùng ${fmtSol(
              (acct.principalSol * mandate.perTradePctOfPrincipal) / 100,
            )} (trước khi bị giới hạn bởi vốn khả dụng và trần/lệnh của operator).`}
          />
          <SliderRow
            label="Giữ lại (reserve)"
            icon={<Lock className="size-3.5 text-emerald-400" />}
            value={mandate.reserveSol}
            unit="SOL"
            min={0}
            max={5}
            step={0.01}
            onChange={(v) => patch({ reserveSol: v })}
            accent="accent-emerald-500"
            hint="SOL luôn chừa lại (phí gas + đệm), không bao giờ đem mua."
          />
          <SliderRow
            label="Số vị thế mở tối đa"
            icon={<Layers className="size-3.5 text-sky-400" />}
            value={mandate.maxOpenPositions}
            unit="vị thế"
            min={1}
            max={50}
            step={1}
            onChange={(v) => patch({ maxOpenPositions: v })}
            accent="accent-sky-500"
          />

          <Separator className="opacity-30" />

          <SliderRow
            label="Cắt lỗ danh mục (drawdown)"
            icon={<TrendingDown className="size-3.5 text-red-400" />}
            value={mandate.maxDrawdownPct}
            unit="%"
            min={1}
            max={100}
            step={1}
            onChange={(v) => patch({ maxDrawdownPct: v })}
            accent="accent-red-500"
            hint="Dừng vào lệnh mới khi tổng lỗ (đã+chưa chốt) chạm ngưỡng này so với vốn gốc."
          />
          <SliderRow
            label="Giới hạn lỗ trong ngày"
            icon={<TrendingDown className="size-3.5 text-red-400" />}
            value={mandate.dailyLossLimitPct}
            unit="%"
            min={1}
            max={100}
            step={1}
            onChange={(v) => patch({ dailyLossLimitPct: v })}
            accent="accent-red-500"
            hint="Dừng vào lệnh mới trong ngày khi lỗ đã chốt vượt ngưỡng này."
          />

          {/* Breach action */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">
              Khi chạm ngưỡng cắt lỗ danh mục
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { k: "halt", label: "Chỉ dừng mua" },
                  { k: "halt-and-liquidate", label: "Dừng + bán hết" },
                ] as { k: DrawdownBreachAction; label: string }[]
              ).map((o) => (
                <button
                  key={o.k}
                  type="button"
                  onClick={() => patch({ onDrawdownBreach: o.k })}
                  className={`rounded-lg px-3 py-2.5 text-xs font-semibold transition-colors ${
                    mandate.onDrawdownBreach === o.k
                      ? "bg-amber-500 text-black"
                      : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-zinc-600">
              {mandate.onDrawdownBreach === "halt-and-liquidate"
                ? "Khi thủng ngưỡng, bot sẽ bán hết các vị thế (giữ lại moon bag nếu có)."
                : "Khi thủng ngưỡng, bot chỉ ngừng mua mới; vị thế đang giữ vẫn theo chiến lược bán."}
            </p>
          </div>

          <button
            type="button"
            onClick={() => saveFields(false)}
            disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-zinc-800 px-4 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:bg-zinc-700 disabled:opacity-60"
          >
            <Save className="size-4" />
            Lưu cấu hình
          </button>
        </CardContent>
      </Card>

      {/* Controls */}
      <Card className="border-zinc-800/80 bg-zinc-900/50">
        <CardHeader className="pb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-100">
            Điều khiển uỷ thác
          </h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            {mandate.status !== "active" && (
              <button
                type="button"
                onClick={() => saveFields(true)}
                disabled={saving}
                className="flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-emerald-400 disabled:opacity-60"
              >
                <Play className="size-4" />
                {mandate.status === "paused" ? "Tiếp tục uỷ thác" : "Bắt đầu uỷ thác"}
              </button>
            )}
            {mandate.status === "active" && (
              <button
                type="button"
                onClick={() => runAction("pause")}
                disabled={saving}
                className="flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-amber-400 disabled:opacity-60"
              >
                <Pause className="size-4" />
                Tạm dừng
              </button>
            )}
            {mandate.status !== "stopped" && (
              <button
                type="button"
                onClick={() => setConfirmStop(true)}
                disabled={saving}
                className="flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-950/30 px-5 py-2.5 text-sm font-semibold text-red-400 transition-colors hover:bg-red-950/50 disabled:opacity-60"
              >
                <Square className="size-4" />
                Dừng & rút
              </button>
            )}
          </div>

          <p className="flex items-start gap-1.5 text-xs text-zinc-600">
            <Info className="size-3 mt-0.5 shrink-0" />
            <span>
              <strong className="text-zinc-500">Tạm dừng</strong>: ngừng mua mới, vị thế
              đang giữ vẫn được quản lý bán.{" "}
              <strong className="text-zinc-500">Dừng &amp; rút</strong>: ngừng hẳn, có thể
              bán hết vị thế để thu về SOL.
            </span>
          </p>
        </CardContent>
      </Card>

      {/* Stop confirm dialog */}
      {confirmStop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
            <div className="flex items-center gap-2 text-red-400">
              <AlertTriangle className="size-5" />
              <h3 className="text-base font-bold">Dừng uỷ thác?</h3>
            </div>
            <p className="mt-3 text-sm text-zinc-400">
              Bot sẽ ngừng mua mới ngay lập tức. Bạn có muốn bán hết{" "}
              {acct.openCount} vị thế đang mở để thu về SOL không?
            </p>
            <p className="mt-2 text-xs text-zinc-600">
              (Phần moon bag — tỷ lệ giữ lại tự bán tay — vẫn được giữ nguyên.)
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => runAction("stop", true)}
                disabled={saving}
                className="flex items-center justify-center gap-2 rounded-xl bg-red-500 px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-red-400 disabled:opacity-60"
              >
                <Square className="size-4" />
                Dừng &amp; bán hết vị thế
              </button>
              <button
                type="button"
                onClick={() => runAction("stop", false)}
                disabled={saving}
                className="rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:bg-zinc-700 disabled:opacity-60"
              >
                Chỉ dừng, giữ nguyên vị thế
              </button>
              <button
                type="button"
                onClick={() => setConfirmStop(false)}
                disabled={saving}
                className="rounded-xl px-4 py-2 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-300"
              >
                Huỷ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Security note */}
      <Card className="border-amber-900/30 bg-amber-950/10">
        <CardContent className="py-4">
          <div className="flex gap-3">
            <ShieldCheck className="size-5 shrink-0 text-amber-500/60 mt-0.5" />
            <div className="space-y-1 text-xs text-zinc-500">
              <p className="font-medium text-zinc-400">Lưu ý an toàn</p>
              <p>
                Vốn gốc là giới hạn <em>phần mềm</em> — bot tự kỷ luật không tiêu quá số
                này. Solana không có cơ chế hạn mức on-chain như EVM, nên nếu server bị
                xâm nhập, key vẫn có thể tiêu toàn bộ ví.
              </p>
              <p className="text-amber-500/80">
                Khuyến nghị: chỉ nạp đúng số SOL bạn muốn uỷ thác vào ví này (tư duy ví
                burner).
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
