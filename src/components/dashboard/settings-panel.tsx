"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Settings,
  Sliders,
  Send,
  Hash,
  Plus,
  Trash2,
  Save,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  ToggleLeft,
  ToggleRight,
  Zap,
  ShieldCheck,
  Info,
  TrendingUp,
  TrendingDown,
  Timer,
  Target,
  Hand,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TelegramAccount {
  id: string;
  username: string;
  label: string;
  enabled: boolean;
}

interface XAccount {
  id: string;
  handle: string;
  label: string;
  enabled: boolean;
}

interface TakeProfitTier {
  id: string;
  multiplier: number;
  sellPercent: number;
}

type SellMode = "ladder" | "single" | "trailing" | "manual";

interface SellStrategy {
  enabled: boolean;
  mode: SellMode;
  tiers: TakeProfitTier[];
  singleTargetMultiplier: number;
  trailingStopPercent: number;
  trailingActivateMultiplier: number;
  stopLossPercent: number;
  maxHoldMinutes: number;
  manualHoldPercent: number;
}

interface TradingSettings {
  buyVolumeSol: number;
  autoBuyEnabled: boolean;
  minGemScoreToTrigger: number;
  telegramAccounts: TelegramAccount[];
  xAccounts: XAccount[];
  socialWeights: { telegram: number; x: number };
  sellStrategy: SellStrategy;
  updatedAt?: string;
}

const DEFAULT: TradingSettings = {
  buyVolumeSol: 0.1,
  autoBuyEnabled: false,
  minGemScoreToTrigger: 80,
  telegramAccounts: [],
  xAccounts: [],
  socialWeights: { telegram: 50, x: 50 },
  sellStrategy: {
    enabled: true,
    mode: "ladder",
    tiers: [
      { id: "t2", multiplier: 2, sellPercent: 50 },
      { id: "t4", multiplier: 4, sellPercent: 10 },
      { id: "t6", multiplier: 6, sellPercent: 10 },
      { id: "t8", multiplier: 8, sellPercent: 10 },
      { id: "t10", multiplier: 10, sellPercent: 10 },
    ],
    singleTargetMultiplier: 3,
    trailingStopPercent: 20,
    trailingActivateMultiplier: 2,
    stopLossPercent: 0,
    maxHoldMinutes: 0,
    manualHoldPercent: 10,
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionLabel({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="flex size-7 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400">
        {icon}
      </span>
      <h2 className="text-sm font-semibold text-zinc-100 tracking-wide uppercase">
        {children}
      </h2>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        checked
          ? "bg-amber-500/15 text-amber-400 hover:bg-amber-500/25"
          : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
      }`}
      aria-pressed={checked}
    >
      {checked ? (
        <ToggleRight className="size-4" />
      ) : (
        <ToggleLeft className="size-4" />
      )}
      {label}
    </button>
  );
}

function AccountRow({
  label,
  sublabel,
  enabled,
  onToggle,
  onDelete,
  showDelete,
}: {
  label: string;
  sublabel: string;
  enabled: boolean;
  onToggle: () => void;
  onDelete: () => void;
  showDelete: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-zinc-100">{label}</p>
        <p className="truncate text-xs text-zinc-500">{sublabel}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
            enabled
              ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
              : "bg-zinc-800 text-zinc-500 hover:bg-zinc-700"
          }`}
        >
          {enabled ? "Bật" : "Tắt"}
        </button>
        {showDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="rounded-lg p-1.5 text-zinc-600 transition-colors hover:bg-red-950/40 hover:text-red-400"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function SettingsPanel() {
  const [settings, setSettings] = useState<TradingSettings>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Telegram add form
  const [tgUsername, setTgUsername] = useState("");
  const [tgLabel, setTgLabel] = useState("");

  // X add form
  const [xHandle, setXHandle] = useState("");
  const [xLabel, setXLabel] = useState("");

  // Hidden API key preview
  const [showVolume, setShowVolume] = useState(false);

  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load settings on mount
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data: TradingSettings) => {
        setSettings(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  const save = useCallback(async (next: TradingSettings) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error("Lưu thất bại");
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không xác định");
    } finally {
      setSaving(false);
    }
  }, []);

  function update(patch: Partial<TradingSettings>) {
    setSettings((prev) => ({ ...prev, ...patch }));
  }

  function handleSave() {
    save(settings);
  }

  // Telegram
  function addTelegram() {
    const username = tgUsername.trim();
    if (!username) return;
    const account: TelegramAccount = {
      id: uid(),
      username: username.startsWith("@") ? username : `@${username}`,
      label: tgLabel.trim() || username,
      enabled: true,
    };
    update({ telegramAccounts: [...settings.telegramAccounts, account] });
    setTgUsername("");
    setTgLabel("");
  }

  function toggleTelegram(id: string) {
    update({
      telegramAccounts: settings.telegramAccounts.map((a) =>
        a.id === id ? { ...a, enabled: !a.enabled } : a
      ),
    });
  }

  function removeTelegram(id: string) {
    update({
      telegramAccounts: settings.telegramAccounts.filter((a) => a.id !== id),
    });
  }

  // X
  function addX() {
    const handle = xHandle.trim();
    if (!handle) return;
    const account: XAccount = {
      id: uid(),
      handle: handle.startsWith("@") ? handle : `@${handle}`,
      label: xLabel.trim() || handle,
      enabled: true,
    };
    update({ xAccounts: [...settings.xAccounts, account] });
    setXHandle("");
    setXLabel("");
  }

  function toggleX(id: string) {
    update({
      xAccounts: settings.xAccounts.map((a) =>
        a.id === id ? { ...a, enabled: !a.enabled } : a
      ),
    });
  }

  function removeX(id: string) {
    update({ xAccounts: settings.xAccounts.filter((a) => a.id !== id) });
  }

  // Social weight normalization: keep sum = 100
  function updateSocialWeight(
    key: "telegram" | "x",
    raw: number
  ) {
    const val = clamp(Math.round(raw), 0, 100);
    const other = 100 - val;
    update({
      socialWeights:
        key === "telegram"
          ? { telegram: val, x: other }
          : { telegram: other, x: val },
    });
  }

  // ── Sell strategy helpers ──────────────────────────────────────────────
  function updateSell(patch: Partial<SellStrategy>) {
    update({ sellStrategy: { ...settings.sellStrategy, ...patch } });
  }

  function addTier() {
    const tiers = settings.sellStrategy.tiers;
    const nextMult =
      tiers.length > 0
        ? Math.max(...tiers.map((t) => t.multiplier)) + 2
        : 2;
    updateSell({
      tiers: [
        ...tiers,
        { id: uid(), multiplier: nextMult, sellPercent: 10 },
      ],
    });
  }

  function updateTier(id: string, patch: Partial<TakeProfitTier>) {
    updateSell({
      tiers: settings.sellStrategy.tiers.map((t) =>
        t.id === id ? { ...t, ...patch } : t
      ),
    });
  }

  function removeTier(id: string) {
    updateSell({
      tiers: settings.sellStrategy.tiers.filter((t) => t.id !== id),
    });
  }

  const sell = settings.sellStrategy;
  const ladderSellTotal = sell.tiers.reduce((s, t) => s + t.sellPercent, 0);
  const ladderRemainder = Math.max(0, 100 - ladderSellTotal);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
      </div>
    );
  }

  const solSteps = [0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1.0];

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-8">
      {/* Page title */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2.5 text-xl font-bold text-zinc-50">
            <Settings className="size-5 text-amber-400" />
            Cài đặt hệ thống
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Cấu hình volume mua, tài khoản xã hội và trọng số GemScore
          </p>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex shrink-0 items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-amber-400 disabled:opacity-60"
        >
          {saving ? (
            <>
              <span className="size-4 animate-spin rounded-full border-2 border-black border-t-transparent" />
              Đang lưu…
            </>
          ) : (
            <>
              <Save className="size-4" />
              Lưu cài đặt
            </>
          )}
        </button>
      </div>

      {/* Saved / Error banner */}
      {saved && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
          <CheckCircle2 className="size-4 shrink-0" />
          Cài đặt đã được lưu thành công!
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <AlertCircle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      {/* ── 1. TRADING VOLUME ──────────────────────────────────────────────── */}
      <Card className="border-zinc-800/80 bg-zinc-900/50">
        <CardHeader className="pb-4">
          <SectionLabel icon={<Zap className="size-4" />}>
            Volume mua Gems
          </SectionLabel>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* SOL amount slider */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-medium text-zinc-300">
                SOL mỗi lệnh mua
              </label>
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-amber-500/15 px-3 py-1 text-lg font-bold font-mono text-amber-400">
                  {settings.buyVolumeSol.toFixed(2)}{" "}
                  <span className="text-sm font-normal text-amber-500/70">
                    SOL
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setShowVolume((v) => !v)}
                  className="rounded p-1 text-zinc-600 hover:text-zinc-400"
                >
                  {showVolume ? (
                    <Eye className="size-3.5" />
                  ) : (
                    <EyeOff className="size-3.5" />
                  )}
                </button>
              </div>
            </div>

            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={settings.buyVolumeSol}
              onChange={(e) =>
                update({ buyVolumeSol: parseFloat(e.target.value) })
              }
              className="w-full accent-amber-500"
            />

            {/* Quick-select chips */}
            <div className="mt-3 flex flex-wrap gap-2">
              {solSteps.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => update({ buyVolumeSol: v })}
                  className={`rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
                    Math.abs(settings.buyVolumeSol - v) < 0.001
                      ? "bg-amber-500 text-black"
                      : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                  }`}
                >
                  {v} SOL
                </button>
              ))}
            </div>

            <p className="mt-2 flex items-center gap-1.5 text-xs text-zinc-600">
              <Info className="size-3" />
              Phạm vi cho phép: 0.05 – 1 SOL mỗi lệnh
            </p>
          </div>

          <Separator className="opacity-30" />

          {/* Auto buy toggle */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-zinc-200">
                Tự động mua khi phát hiện Gem tốt
              </p>
              <p className="text-xs text-zinc-500 mt-0.5">
                Tự động đặt lệnh khi GemScore đạt ngưỡng tối thiểu
              </p>
            </div>
            <Toggle
              checked={settings.autoBuyEnabled}
              onChange={(v) => update({ autoBuyEnabled: v })}
              label={settings.autoBuyEnabled ? "Đang bật" : "Đang tắt"}
            />
          </div>

          {/* Min gem score slider */}
          {settings.autoBuyEnabled && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-zinc-300">
                  GemScore tối thiểu để trigger
                </label>
                <span className="rounded-lg bg-amber-500/15 px-2.5 py-1 text-sm font-bold font-mono text-amber-400">
                  {settings.minGemScoreToTrigger}
                  <span className="text-xs font-normal text-amber-500/70">
                    /100
                  </span>
                </span>
              </div>
              <input
                type="range"
                min={50}
                max={100}
                step={5}
                value={settings.minGemScoreToTrigger}
                onChange={(e) =>
                  update({ minGemScoreToTrigger: parseInt(e.target.value) })
                }
                className="w-full accent-amber-500"
              />
              <div className="flex justify-between text-[10px] text-zinc-600">
                <span>50 — Rủi ro cao</span>
                <span>80 — Cân bằng</span>
                <span>100 — Cực an toàn</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── 1b. SELL STRATEGY ─────────────────────────────────────────────── */}
      <Card className="border-zinc-800/80 bg-zinc-900/50">
        <CardHeader className="pb-4">
          <SectionLabel icon={<TrendingUp className="size-4" />}>
            Chiến lược bán token
          </SectionLabel>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Enable toggle */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-zinc-200">
                Tự động bán khi đang giữ token
              </p>
              <p className="text-xs text-zinc-500 mt-0.5">
                Bot tự khớp lệnh bán theo phương án bên dưới khi giá đạt mục tiêu
              </p>
            </div>
            <Toggle
              checked={sell.enabled}
              onChange={(v) => updateSell({ enabled: v })}
              label={sell.enabled ? "Đang bật" : "Đang tắt"}
            />
          </div>

          {sell.enabled && (
            <>
              {/* Mode selector */}
              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-300">
                  Phương án bán
                </label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(
                    [
                      { k: "ladder", icon: <Target className="size-3.5" />, label: "Bậc thang" },
                      { k: "single", icon: <TrendingUp className="size-3.5" />, label: "Chốt 1 mốc" },
                      { k: "trailing", icon: <TrendingDown className="size-3.5" />, label: "Trailing stop" },
                      { k: "manual", icon: <Hand className="size-3.5" />, label: "Thủ công" },
                    ] as { k: SellMode; icon: React.ReactNode; label: string }[]
                  ).map((m) => (
                    <button
                      key={m.k}
                      type="button"
                      onClick={() => updateSell({ mode: m.k })}
                      className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-semibold transition-colors ${
                        sell.mode === m.k
                          ? "bg-amber-500 text-black"
                          : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                      }`}
                    >
                      {m.icon}
                      {m.label}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-zinc-600">
                  {sell.mode === "ladder" &&
                    "Chia nhỏ vị thế, bán dần theo từng mốc giá nhân (x2, x4…)."}
                  {sell.mode === "single" &&
                    "Bán toàn bộ vị thế một lần khi giá đạt mốc nhân mục tiêu."}
                  {sell.mode === "trailing" &&
                    "Giữ cho lời chạy, chỉ bán khi giá rớt một tỷ lệ so với đỉnh."}
                  {sell.mode === "manual" &&
                    "Bot không tự bán — chỉ áp dụng cắt lỗ / thoát theo thời gian nếu bật."}
                </p>
              </div>

              {/* ── LADDER MODE ── */}
              {sell.mode === "ladder" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-zinc-300">
                      Bậc thang chốt lời
                    </label>
                    <span
                      className={`rounded-lg px-2.5 py-1 text-xs font-bold font-mono ${
                        ladderSellTotal > 100
                          ? "bg-red-500/15 text-red-400"
                          : "bg-emerald-500/15 text-emerald-400"
                      }`}
                    >
                      Đã bán {ladderSellTotal}% · Giữ lại {ladderRemainder}%
                    </span>
                  </div>

                  {ladderSellTotal > 100 && (
                    <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                      <AlertCircle className="size-3.5 shrink-0" />
                      Tổng % bán vượt quá 100% — hãy giảm bớt ở các mốc.
                    </div>
                  )}

                  <div className="space-y-2">
                    {sell.tiers.map((tier) => (
                      <div
                        key={tier.id}
                        className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2.5"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-zinc-500">Giá</span>
                          <input
                            type="number"
                            min={1.1}
                            step={0.5}
                            value={tier.multiplier}
                            onChange={(e) =>
                              updateTier(tier.id, {
                                multiplier: parseFloat(e.target.value) || tier.multiplier,
                              })
                            }
                            className="w-16 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm font-mono font-bold text-amber-400 focus:border-amber-500/50 focus:outline-none"
                          />
                          <span className="text-sm font-bold text-amber-400">x</span>
                        </div>
                        <div className="flex flex-1 items-center gap-2">
                          <span className="text-xs text-zinc-500">bán</span>
                          <input
                            type="range"
                            min={1}
                            max={100}
                            step={1}
                            value={tier.sellPercent}
                            onChange={(e) =>
                              updateTier(tier.id, {
                                sellPercent: parseInt(e.target.value),
                              })
                            }
                            className="flex-1 accent-amber-500"
                          />
                          <span className="w-12 text-right text-sm font-mono font-bold text-zinc-200">
                            {tier.sellPercent}%
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeTier(tier.id)}
                          className="rounded-lg p-1.5 text-zinc-600 transition-colors hover:bg-red-950/40 hover:text-red-400"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={addTier}
                    className="flex items-center gap-2 rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
                  >
                    <Plus className="size-4" />
                    Thêm mốc chốt lời
                  </button>

                  <p className="flex items-start gap-1.5 text-xs text-zinc-600">
                    <Info className="size-3 mt-0.5 shrink-0" />
                    % tính trên vị thế ban đầu. Phần còn lại ({ladderRemainder}%) được
                    giữ để bạn tự bán bằng tay.
                  </p>
                </div>
              )}

              {/* ── SINGLE MODE ── */}
              {sell.mode === "single" && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-sm font-medium text-zinc-300">
                      <Target className="size-3.5 text-amber-400" />
                      Mốc chốt toàn bộ
                    </label>
                    <span className="rounded-lg bg-amber-500/15 px-2.5 py-1 text-sm font-bold font-mono text-amber-400">
                      x{sell.singleTargetMultiplier}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1.5}
                    max={50}
                    step={0.5}
                    value={sell.singleTargetMultiplier}
                    onChange={(e) =>
                      updateSell({
                        singleTargetMultiplier: parseFloat(e.target.value),
                      })
                    }
                    className="w-full accent-amber-500"
                  />
                  <p className="text-xs text-zinc-600">
                    Bán 100% vị thế khi giá đạt x{sell.singleTargetMultiplier} so với
                    giá vào lệnh.
                  </p>
                </div>
              )}

              {/* ── TRAILING MODE ── */}
              {sell.mode === "trailing" && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-5">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-zinc-300">
                        Kích hoạt trailing khi đạt
                      </label>
                      <span className="rounded-lg bg-amber-500/15 px-2.5 py-1 text-sm font-bold font-mono text-amber-400">
                        x{sell.trailingActivateMultiplier}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={20}
                      step={0.5}
                      value={sell.trailingActivateMultiplier}
                      onChange={(e) =>
                        updateSell({
                          trailingActivateMultiplier: parseFloat(e.target.value),
                        })
                      }
                      className="w-full accent-amber-500"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-zinc-300">
                        Bán khi rớt khỏi đỉnh
                      </label>
                      <span className="rounded-lg bg-amber-500/15 px-2.5 py-1 text-sm font-bold font-mono text-amber-400">
                        -{sell.trailingStopPercent}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={5}
                      max={90}
                      step={1}
                      value={sell.trailingStopPercent}
                      onChange={(e) =>
                        updateSell({
                          trailingStopPercent: parseInt(e.target.value),
                        })
                      }
                      className="w-full accent-amber-500"
                    />
                  </div>
                  <p className="text-xs text-zinc-600">
                    Sau khi giá đạt x{sell.trailingActivateMultiplier}, bot theo dõi
                    đỉnh và bán nếu giá giảm {sell.trailingStopPercent}% so với đỉnh.
                  </p>
                </div>
              )}

              <Separator className="opacity-30" />

              {/* ── STOP LOSS (all modes) ── */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm font-medium text-zinc-300">
                    <TrendingDown className="size-3.5 text-red-400" />
                    Cắt lỗ (Stop-loss)
                  </label>
                  <span
                    className={`rounded-lg px-2.5 py-1 text-sm font-bold font-mono ${
                      sell.stopLossPercent > 0
                        ? "bg-red-500/15 text-red-400"
                        : "bg-zinc-800 text-zinc-500"
                    }`}
                  >
                    {sell.stopLossPercent > 0 ? `-${sell.stopLossPercent}%` : "Tắt"}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={90}
                  step={5}
                  value={sell.stopLossPercent}
                  onChange={(e) =>
                    updateSell({ stopLossPercent: parseInt(e.target.value) })
                  }
                  className="w-full accent-red-500"
                />
                <p className="text-xs text-zinc-600">
                  {sell.stopLossPercent > 0
                    ? `Bán toàn bộ nếu giá giảm ${sell.stopLossPercent}% dưới giá vào lệnh.`
                    : "Kéo sang phải để bật cắt lỗ bảo vệ vốn."}
                </p>
              </div>

              <Separator className="opacity-30" />

              {/* ── TIME EXIT (all modes) ── */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm font-medium text-zinc-300">
                    <Timer className="size-3.5 text-sky-400" />
                    Thoát theo thời gian
                  </label>
                  <span
                    className={`rounded-lg px-2.5 py-1 text-sm font-bold font-mono ${
                      sell.maxHoldMinutes > 0
                        ? "bg-sky-500/15 text-sky-400"
                        : "bg-zinc-800 text-zinc-500"
                    }`}
                  >
                    {sell.maxHoldMinutes > 0
                      ? `${sell.maxHoldMinutes} phút`
                      : "Tắt"}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[0, 15, 30, 60, 120, 240, 720, 1440].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => updateSell({ maxHoldMinutes: m })}
                      className={`rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
                        sell.maxHoldMinutes === m
                          ? "bg-sky-500 text-black"
                          : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                      }`}
                    >
                      {m === 0 ? "Tắt" : m < 60 ? `${m}p` : `${m / 60}h`}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-zinc-600">
                  Bán phần còn lại nếu đã giữ quá thời gian này mà chưa đạt mục tiêu.
                </p>
              </div>

              <Separator className="opacity-30" />

              {/* ── MANUAL HOLD % ── */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm font-medium text-zinc-300">
                    <Hand className="size-3.5 text-emerald-400" />
                    Giữ lại để tự bán
                  </label>
                  <span className="rounded-lg bg-emerald-500/15 px-2.5 py-1 text-sm font-bold font-mono text-emerald-400">
                    {sell.manualHoldPercent}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={sell.manualHoldPercent}
                  onChange={(e) =>
                    updateSell({ manualHoldPercent: parseInt(e.target.value) })
                  }
                  className="w-full accent-emerald-500"
                />
                <p className="text-xs text-zinc-600">
                  Phần vị thế bot không bao giờ tự bán — để bạn chủ động chốt tay
                  (moon bag).
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── 2. TELEGRAM ACCOUNTS ──────────────────────────────────────────── */}
      <Card className="border-zinc-800/80 bg-zinc-900/50">
        <CardHeader className="pb-4">
          <SectionLabel icon={<Send className="size-4" />}>
            Tài khoản Telegram
          </SectionLabel>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-zinc-500">
            Thêm tài khoản Telegram để thu thập dữ liệu từ các kênh/group crypto —
            dùng để tính điểm <strong className="text-zinc-400">GemScore Social</strong>.
          </p>

          {/* Account list */}
          <div className="space-y-2">
            {settings.telegramAccounts.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-800 py-6 text-center text-sm text-zinc-600">
                Chưa có tài khoản nào — thêm ít nhất một tài khoản bên dưới
              </div>
            ) : (
              settings.telegramAccounts.map((acc) => (
                <AccountRow
                  key={acc.id}
                  label={acc.label}
                  sublabel={acc.username}
                  enabled={acc.enabled}
                  onToggle={() => toggleTelegram(acc.id)}
                  onDelete={() => removeTelegram(acc.id)}
                  showDelete
                />
              ))
            )}
          </div>

          {/* Add form */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
            <p className="text-xs font-medium text-zinc-400">
              Thêm tài khoản mới
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11px] text-zinc-500">
                  Username / Số điện thoại *
                </label>
                <input
                  type="text"
                  placeholder="@username hoặc +84..."
                  value={tgUsername}
                  onChange={(e) => setTgUsername(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addTelegram()}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-zinc-500">
                  Nhãn hiển thị
                </label>
                <input
                  type="text"
                  placeholder="VD: Bot chính, Tài khoản phụ…"
                  value={tgLabel}
                  onChange={(e) => setTgLabel(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addTelegram()}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={addTelegram}
              disabled={!tgUsername.trim()}
              className="flex items-center gap-2 rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700 disabled:opacity-40"
            >
              <Plus className="size-4" />
              Thêm tài khoản Telegram
            </button>
          </div>
        </CardContent>
      </Card>

      {/* ── 3. X (TWITTER) ACCOUNTS ───────────────────────────────────────── */}
      <Card className="border-zinc-800/80 bg-zinc-900/50">
        <CardHeader className="pb-4">
          <SectionLabel icon={<Hash className="size-4" />}>
            Tài khoản X (Twitter)
          </SectionLabel>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-zinc-500">
            Thêm tài khoản X để theo dõi sentiment, KOL tweets và trending hashtag
            — dùng để tính điểm <strong className="text-zinc-400">GemScore Social</strong>.
          </p>

          {/* Account list */}
          <div className="space-y-2">
            {settings.xAccounts.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-800 py-6 text-center text-sm text-zinc-600">
                Chưa có tài khoản nào — thêm ít nhất một tài khoản bên dưới
              </div>
            ) : (
              settings.xAccounts.map((acc) => (
                <AccountRow
                  key={acc.id}
                  label={acc.label}
                  sublabel={acc.handle}
                  enabled={acc.enabled}
                  onToggle={() => toggleX(acc.id)}
                  onDelete={() => removeX(acc.id)}
                  showDelete
                />
              ))
            )}
          </div>

          {/* Add form */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
            <p className="text-xs font-medium text-zinc-400">
              Thêm tài khoản mới
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11px] text-zinc-500">
                  Handle X *
                </label>
                <input
                  type="text"
                  placeholder="@handle"
                  value={xHandle}
                  onChange={(e) => setXHandle(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addX()}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-zinc-500">
                  Nhãn hiển thị
                </label>
                <input
                  type="text"
                  placeholder="VD: KOL chính, Monitor…"
                  value={xLabel}
                  onChange={(e) => setXLabel(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addX()}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={addX}
              disabled={!xHandle.trim()}
              className="flex items-center gap-2 rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700 disabled:opacity-40"
            >
              <Plus className="size-4" />
              Thêm tài khoản X
            </button>
          </div>
        </CardContent>
      </Card>

      {/* ── 4. GEMSCORE WEIGHTS ───────────────────────────────────────────── */}
      <Card className="border-zinc-800/80 bg-zinc-900/50">
        <CardHeader className="pb-4">
          <SectionLabel icon={<Sliders className="size-4" />}>
            Trọng số GemScore Social
          </SectionLabel>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-xs text-zinc-500">
            Điều chỉnh mức ảnh hưởng của từng nền tảng đến điểm GemScore.
            Tổng luôn = 100%.
          </p>

          {/* Telegram weight */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm font-medium text-zinc-300">
                <Send className="size-3.5 text-sky-400" />
                Telegram
              </label>
              <span className="font-mono text-sm font-bold text-sky-400">
                {settings.socialWeights.telegram}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={settings.socialWeights.telegram}
              onChange={(e) =>
                updateSocialWeight("telegram", parseInt(e.target.value))
              }
              className="w-full accent-sky-500"
            />
          </div>

          {/* X weight */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm font-medium text-zinc-300">
                <Hash className="size-3.5 text-zinc-300" />X (Twitter)
              </label>
              <span className="font-mono text-sm font-bold text-zinc-300">
                {settings.socialWeights.x}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={settings.socialWeights.x}
              onChange={(e) =>
                updateSocialWeight("x", parseInt(e.target.value))
              }
              className="w-full accent-zinc-400"
            />
          </div>

          {/* Visual bar */}
          <div className="overflow-hidden rounded-full h-3 bg-zinc-800 flex">
            <div
              className="h-full bg-sky-500 transition-all"
              style={{ width: `${settings.socialWeights.telegram}%` }}
            />
            <div
              className="h-full bg-zinc-400 transition-all"
              style={{ width: `${settings.socialWeights.x}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-zinc-600">
            <span className="flex items-center gap-1">
              <span className="inline-block size-2 rounded-full bg-sky-500" />
              Telegram {settings.socialWeights.telegram}%
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block size-2 rounded-full bg-zinc-400" />X{" "}
              {settings.socialWeights.x}%
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ── 5. INFO / DISCLAIMER ─────────────────────────────────────────── */}
      <Card className="border-amber-900/30 bg-amber-950/10">
        <CardContent className="py-4">
          <div className="flex gap-3">
            <ShieldCheck className="size-5 shrink-0 text-amber-500/60 mt-0.5" />
            <div className="space-y-1 text-xs text-zinc-500">
              <p className="font-medium text-zinc-400">Lưu ý quan trọng</p>
              <p>
                Cài đặt được lưu cục bộ trên server. Tính năng tự động mua chỉ
                hoạt động khi bot Solana trading đã được kết nối và cấu hình
                ví đúng trong{" "}
                <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[10px] text-zinc-300">
                  .env.local
                </code>
                .
              </p>
              <p>
                Dữ liệu social từ Telegram và X chỉ dùng để tính điểm GemScore —
                không được dùng cho mục đích thương mại hay chia sẻ bên thứ ba.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bottom save button (mobile convenience) */}
      <div className="flex justify-end pb-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 rounded-xl bg-amber-500 px-6 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-amber-400 disabled:opacity-60"
        >
          {saving ? (
            <>
              <span className="size-4 animate-spin rounded-full border-2 border-black border-t-transparent" />
              Đang lưu…
            </>
          ) : (
            <>
              <Save className="size-4" />
              Lưu cài đặt
            </>
          )}
        </button>
      </div>
    </div>
  );
}
