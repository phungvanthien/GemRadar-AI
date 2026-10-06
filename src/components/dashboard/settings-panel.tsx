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
  Globe,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useLanguage } from "@/lib/i18n/context";

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
  const { t } = useLanguage();
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
          {enabled ? (t("common.on") || "Đang bật") : (t("common.off") || "Đang tắt")}
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
  const { language, setLanguage, t } = useLanguage();
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
      if (!res.ok) throw new Error(t("settings.saveFailed"));
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("settings.unknownError"));
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
            {t("settings.systemSettings") || "Cài đặt hệ thống"}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {t("settings.tradingDesc") || "Cấu hình volume mua, tài khoản xã hội và trọng số GemScore"}
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
              {t("common.saving") || "Đang lưu…"}
            </>
          ) : (
            <>
              <Save className="size-4" />
              {t("common.save") || "Lưu cài đặt"}
            </>
          )}
        </button>
      </div>

      {/* Saved / Error banner */}
      {saved && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
          <CheckCircle2 className="size-4 shrink-0" />
          {t("common.savedSuccess") || "Cài đặt đã được lưu thành công!"}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <AlertCircle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      {/* ── 0. LANGUAGE SELECTION ──────────────────────────────────────────────── */}
      <Card className="border-zinc-800/80 bg-zinc-900/50">
        <CardHeader className="pb-4">
          <SectionLabel icon={<Globe className="size-4" />}>
            {t("settings.language") || "Language"}
          </SectionLabel>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-xs text-zinc-500">
            {t("settings.languageDesc") || "Select your preferred language"}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {(
              [
                { id: "vi", label: "Tiếng Việt" },
                { id: "en", label: "English" },
                { id: "es", label: "Español" },
                { id: "zh", label: "中文" },
                { id: "fr", label: "Français" },
                { id: "ja", label: "日本語" },
              ] as const
            ).map((lang) => (
              <button
                key={lang.id}
                type="button"
                onClick={() => setLanguage(lang.id)}
                className={`flex items-center justify-between rounded-lg border px-4 py-3 text-sm font-medium transition-colors ${
                  language === lang.id
                    ? "border-amber-500/50 bg-amber-500/10 text-amber-400"
                    : "border-zinc-800 bg-zinc-950/50 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-800"
                }`}
              >
                {lang.label}
                {language === lang.id && <CheckCircle2 className="size-4" />}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── 1. TRADING VOLUME ──────────────────────────────────────────────── */}
      <Card className="border-zinc-800/80 bg-zinc-900/50">
        <CardHeader className="pb-4">
          <SectionLabel icon={<Zap className="size-4" />}>
            {t("settings.buyVolume")}
          </SectionLabel>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* SOL amount slider */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-medium text-zinc-300">
                {t("settings.buyVolume")}
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
              {t("settings.rangeLimit")?.replace("{min}", "0.05").replace("{max}", "1") || "Phạm vi cho phép: 0.05 – 1 SOL mỗi lệnh"}
            </p>
          </div>

          <Separator className="opacity-30" />

          {/* Auto buy toggle */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-zinc-200">
                {t("settings.autoBuy")}
              </p>
              <p className="text-xs text-zinc-500 mt-0.5">
                {t("settings.autoBuyDesc")}
              </p>
            </div>
            <Toggle
              checked={settings.autoBuyEnabled}
              onChange={(v) => update({ autoBuyEnabled: v })}
              label={settings.autoBuyEnabled ? (t("common.on") || "Đang bật") : (t("common.off") || "Đang tắt")}
            />
          </div>

          {/* Min gem score slider */}
          {settings.autoBuyEnabled && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-zinc-300">
                  {t("settings.minGemScore")}
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
                <span>50 — High risk</span>
                <span>80 — Balanced</span>
                <span>100 — Very safe</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── 1b. SELL STRATEGY ─────────────────────────────────────────────── */}
      <Card className="border-zinc-800/80 bg-zinc-900/50">
        <CardHeader className="pb-4">
          <SectionLabel icon={<TrendingUp className="size-4" />}>
            {t("settings.takeProfit")}
          </SectionLabel>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Enable toggle */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-zinc-200">
                {t("settings.autoSell")}
              </p>
              <p className="text-xs text-zinc-500 mt-0.5">
                {t("settings.autoSellDesc")}
              </p>
            </div>
            <Toggle
              checked={sell.enabled}
              onChange={(v) => updateSell({ enabled: v })}
              label={sell.enabled ? (t("common.on") || "Đang bật") : (t("common.off") || "Đang tắt")}
            />
          </div>

          {sell.enabled && (
            <>
              {/* Mode selector */}
              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-300">
                  {t("settings.sellModeMode")}
                </label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(
                    [
                      { k: "ladder", icon: <Target className="size-3.5" />, label: t("settings.modeLadder") },
                      { k: "single", icon: <TrendingUp className="size-3.5" />, label: t("settings.modeSingle") },
                      { k: "trailing", icon: <TrendingDown className="size-3.5" />, label: "Trailing stop" },
                      { k: "manual", icon: <Hand className="size-3.5" />, label: t("settings.modeManual") },
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
                  {sell.mode === "ladder" && t("settings.modeLadderDesc")}
                  {sell.mode === "single" && t("settings.modeSingleDesc")}
                  {sell.mode === "trailing" && t("settings.modeTrailingDesc")}
                  {sell.mode === "manual" && t("settings.modeManualDesc")}
                </p>
              </div>

              {/* ── LADDER MODE ── */}
              {sell.mode === "ladder" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-zinc-300">
                      {t("settings.ladderTitle")}
                    </label>
                    <span
                      className={`rounded-lg px-2.5 py-1 text-xs font-bold font-mono ${
                        ladderSellTotal > 100
                          ? "bg-red-500/15 text-red-400"
                          : "bg-emerald-500/15 text-emerald-400"
                      }`}
                    >
                      {t("settings.sold")} {ladderSellTotal}% · {t("settings.kept")} {ladderRemainder}%
                    </span>
                  </div>

                  {ladderSellTotal > 100 && (
                    <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                      <AlertCircle className="size-3.5 shrink-0" />
                      {t("settings.ladderWarning")}
                    </div>
                  )}

                  <div className="space-y-2">
                    {sell.tiers.map((tier) => (
                      <div
                        key={tier.id}
                        className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2.5"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-zinc-500">{t("settings.price")}</span>
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
                          <span className="text-xs text-zinc-500">{t("settings.sellPercent")}</span>
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
                    {t("settings.addTier")}
                  </button>

                  <p className="flex items-start gap-1.5 text-xs text-zinc-600">
                    <Info className="size-3 mt-0.5 shrink-0" />
                    {t("settings.remainderNote")?.replace("{rem}", ladderRemainder.toString())}
                  </p>
                </div>
              )}

              {/* ── SINGLE MODE ── */}
              {sell.mode === "single" && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-sm font-medium text-zinc-300">
                      <Target className="size-3.5 text-amber-400" />
                      {t("settings.singleTargetTitle")}
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
                    {t("settings.singleTargetDesc")?.replace("{x}", sell.singleTargetMultiplier.toString())}
                  </p>
                </div>
              )}

              {/* ── TRAILING MODE ── */}
              {sell.mode === "trailing" && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-5">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-zinc-300">
                        {t("settings.trailingActivateTitle")}
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
                        {t("settings.trailingDropTitle")}
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
                    {t("settings.trailingDesc")?.replace("{x}", sell.trailingActivateMultiplier.toString()).replace("{y}", sell.trailingStopPercent.toString())}
                  </p>
                </div>
              )}

              <Separator className="opacity-30" />

              {/* ── STOP LOSS (all modes) ── */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm font-medium text-zinc-300">
                    <TrendingDown className="size-3.5 text-red-400" />
                    {t("settings.stopLossTitle")}
                  </label>
                  <span
                    className={`rounded-lg px-2.5 py-1 text-sm font-bold font-mono ${
                      sell.stopLossPercent > 0
                        ? "bg-red-500/15 text-red-400"
                        : "bg-zinc-800 text-zinc-500"
                    }`}
                  >
                    {sell.stopLossPercent > 0 ? `-${sell.stopLossPercent}%` : t("common.off")}
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
                    ? t("settings.stopLossOn")?.replace("{x}", sell.stopLossPercent.toString())
                    : t("settings.stopLossOff")}
                </p>
              </div>

              <Separator className="opacity-30" />

              {/* ── TIME EXIT (all modes) ── */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm font-medium text-zinc-300">
                    <Timer className="size-3.5 text-sky-400" />
                    {t("settings.timeExitTitle")}
                  </label>
                  <span
                    className={`rounded-lg px-2.5 py-1 text-sm font-bold font-mono ${
                      sell.maxHoldMinutes > 0
                        ? "bg-sky-500/15 text-sky-400"
                        : "bg-zinc-800 text-zinc-500"
                    }`}
                  >
                    {sell.maxHoldMinutes > 0
                      ? `${sell.maxHoldMinutes} m`
                      : t("common.off")}
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
                      {m === 0 ? t("common.off") : m < 60 ? `${m}m` : `${m / 60}h`}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-zinc-600">
                  {t("settings.timeExitDesc")}
                </p>
              </div>

              <Separator className="opacity-30" />

              {/* ── MANUAL HOLD % ── */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm font-medium text-zinc-300">
                    <Hand className="size-3.5 text-emerald-400" />
                    {t("settings.moonBagTitle")}
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
                  {t("settings.moonBagDesc")}
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
            {t("settings.telegramTitle")}
          </SectionLabel>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-zinc-500">
            {t("settings.telegramDesc1")} <strong className="text-zinc-400">GemScore Social</strong>.
          </p>

          {/* Account list */}
          <div className="space-y-2">
            {settings.telegramAccounts.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-800 py-6 text-center text-sm text-zinc-600">
                {t("common.noAccounts") || "Chưa có tài khoản nào — thêm ít nhất một tài khoản bên dưới"}
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
              {t("settings.addAccount")}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11px] text-zinc-500">
                  {t("settings.usernameLabel")}
                </label>
                <input
                  type="text"
                  placeholder={t("settings.usernamePlaceholder")}
                  value={tgUsername}
                  onChange={(e) => setTgUsername(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addTelegram()}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-zinc-500">
                  {t("settings.labelLabel")}
                </label>
                <input
                  type="text"
                  placeholder={t("settings.labelPlaceholder")}
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
              {t("settings.addAccount")}
            </button>
          </div>
        </CardContent>
      </Card>

      {/* ── 3. X (TWITTER) ACCOUNTS ───────────────────────────────────────── */}
      <Card className="border-zinc-800/80 bg-zinc-900/50">
        <CardHeader className="pb-4">
          <SectionLabel icon={<Hash className="size-4" />}>
            {t("settings.xTitle")}
          </SectionLabel>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-zinc-500">
            {t("settings.xDesc1")} <strong className="text-zinc-400">GemScore Social</strong>.
          </p>

          {/* Account list */}
          <div className="space-y-2">
            {settings.xAccounts.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-800 py-6 text-center text-sm text-zinc-600">
                {t("common.noAccounts") || "Chưa có tài khoản nào — thêm ít nhất một tài khoản bên dưới"}
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
              {t("settings.addAccount")}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11px] text-zinc-500">
                  {t("settings.usernameLabel")}
                </label>
                <input
                  type="text"
                  placeholder={t("settings.xUsernamePlaceholder")}
                  value={xHandle}
                  onChange={(e) => setXHandle(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addX()}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-zinc-500">
                  {t("settings.labelLabel")}
                </label>
                <input
                  type="text"
                  placeholder={t("settings.xLabelPlaceholder")}
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
              {t("settings.addAccount")}
            </button>
          </div>
        </CardContent>
      </Card>

      {/* ── 4. GEMSCORE WEIGHTS ───────────────────────────────────────────── */}
      <Card className="border-zinc-800/80 bg-zinc-900/50">
        <CardHeader className="pb-4">
          <SectionLabel icon={<Sliders className="size-4" />}>
            {t("settings.weightTitle2")}
          </SectionLabel>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-xs text-zinc-500">
            {t("settings.weightDesc2")}
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
              <p className="font-medium text-zinc-400">{t("settings.importantNoteTitle")}</p>
              <p>
                {t("settings.localSaveNote")}
              </p>
              <p>
                {t("settings.socialNote")}
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
              {t("common.saving")}
            </>
          ) : (
            <>
              <Save className="size-4" />
              {t("common.save")}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
