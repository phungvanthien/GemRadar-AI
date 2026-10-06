"use client";

import { useState } from "react";
import { Radio, ShieldCheck, ShieldAlert, Gauge } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useRugcheckStream } from "@/hooks/useRugcheckStream";
import { formatCurrency } from "@/lib/utils";
import { useLanguage } from "@/lib/i18n/context";
import type { RugcheckStreamToken } from "@/lib/types";

// RugCheck's normalised score is 0-100, higher = riskier. Map it to a badge
// tone the same way the rest of the dashboard reads risk.
function riskBadge(score: number, t: (k: string) => string) {
  if (score >= 60) return { variant: "danger" as const, label: t("activity.highRisk") || "High risk" };
  if (score >= 30) return { variant: "default" as const, label: t("activity.caution") || "Caution" };
  return { variant: "success" as const, label: t("activity.lowRisk") || "Low risk" };
}

function shortMint(mint: string) {
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

// Slider positions map to a reveal interval (ms between new tokens). Position 0
// is unthrottled ("live"); higher positions space tokens out so they're
// readable. The slider index — not the ms value — is the control's state.
const SPEED_STEPS = [
  { labelKey: "activity.speedLive", defaultLabel: "Live", intervalMs: 0 },
  { labelKey: "activity.speedFast", defaultLabel: "Fast", intervalMs: 1500 },
  { labelKey: "activity.speedMedium", defaultLabel: "Medium", intervalMs: 3000 },
  { labelKey: "activity.speedSlow", defaultLabel: "Slow", intervalMs: 6000 },
  { labelKey: "activity.speedSlowest", defaultLabel: "Slowest", intervalMs: 10000 },
];

function TokenRow({ token, t }: { token: RugcheckStreamToken, t: (k: string) => string }) {
  const risk = riskBadge(token.scoreNormalised, t);
  const label = token.symbol || token.name || shortMint(token.mint);

  return (
    <li className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-zinc-800/30">
      <span className="mt-0.5 shrink-0 text-zinc-600">
        {token.scoreNormalised >= 60 ? (
          <ShieldAlert className="size-4 text-red-400" />
        ) : (
          <ShieldCheck className="size-4 text-emerald-400/70" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold text-zinc-100">{label}</span>
          <Badge variant={risk.variant} className="shrink-0 text-[10px]">
            {risk.label} {token.scoreNormalised}
          </Badge>
        </div>
        <p className="truncate font-mono text-[11px] text-zinc-500">{shortMint(token.mint)}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-500">
          {token.mintAuthorityRevoked && <span className="text-emerald-400/70">{t("activity.mintRevoked") || "mint revoked"}</span>}
          {token.freezeAuthorityRevoked && <span className="text-emerald-400/70">{t("activity.freezeRevoked") || "freeze revoked"}</span>}
          {token.totalMarketLiquidity !== null && token.totalMarketLiquidity > 0 && (
            <span>LP {formatCurrency(token.totalMarketLiquidity, true)}</span>
          )}
          {token.totalHolders !== null && token.totalHolders > 0 && (
            <span>{token.totalHolders.toLocaleString()} {t("activity.holders") || "holders"}</span>
          )}
        </div>
        {token.topRisks.length > 0 && (
          <p className="mt-1 truncate text-[11px] text-amber-400/70">
            {token.topRisks.join(" · ")}
          </p>
        )}
      </div>
    </li>
  );
}

export function LiveFeed() {
  const { t } = useLanguage();
  const [speedIdx, setSpeedIdx] = useState(0);
  const revealIntervalMs = SPEED_STEPS[speedIdx].intervalMs;
  const { tokens, connected, error, pending } = useRugcheckStream({
    max: 40,
    revealIntervalMs,
  });

  // Slower reveal (slider toward "Slowest") fills more of the track. Fill
  // tracks the slider position directly: empty at Live, full at Slowest.
  const maxIdx = SPEED_STEPS.length - 1;
  const fillPercent = (speedIdx / maxIdx) * 100;
  const trackFill = `linear-gradient(to right, #f97316 0%, #f97316 ${fillPercent}%, rgb(39 39 42) ${fillPercent}%, rgb(39 39 42) 100%)`;

  return (
    <aside className="flex h-full flex-col p-4 lg:max-h-[calc(100vh-4rem)]">
      <Card className="flex flex-1 flex-col border-orange-500/10 overflow-hidden">
        <CardHeader className="border-b border-zinc-800/80 pb-3">
          <CardTitle className="flex items-center gap-2 text-orange-400">
            <Radio className="size-4" />
            {t("activity.feedTitle") || "Live RugCheck Feed"}
          </CardTitle>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span
              className={`size-2 rounded-full ${
                connected ? "animate-pulse bg-emerald-400" : "bg-zinc-600"
              }`}
            />
            {connected ? (t("activity.streaming") || "Streaming new tokens") : (t("common.connecting") || "Connecting…")}
          </div>

          <div className="mt-3 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-zinc-500">
              <span className="flex items-center gap-1.5">
                <Gauge className="size-3.5" />
                {t("activity.revealSpeed") || "Reveal speed"}
              </span>
              <span className="font-medium text-zinc-300">
                {t(SPEED_STEPS[speedIdx].labelKey) || SPEED_STEPS[speedIdx].defaultLabel}
                {pending > 0 && (
                  <span className="ml-1.5 text-orange-400/80">
                    +{pending} {t("activity.queued") || "queued"}
                  </span>
                )}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={SPEED_STEPS.length - 1}
              step={1}
              value={speedIdx}
              onChange={(e) => setSpeedIdx(Number(e.target.value))}
              aria-label="Token reveal speed"
              style={{ background: trackFill }}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none transition-[background] duration-200 [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-orange-500 [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(249,115,22,0.6)] [&::-webkit-slider-thumb]:transition-shadow [&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-orange-500 [&::-moz-range-thumb]:shadow-[0_0_8px_rgba(249,115,22,0.6)]"
            />
            <div className="flex justify-between text-[10px] text-zinc-600">
              <span>{t("activity.speedLive") || "Live"}</span>
              <span>{t("activity.speedSlowest") || "Slowest"}</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex-1 p-0 relative">
          {error && (
            <p className="px-4 py-3 text-xs text-red-400">{error}</p>
          )}
          <ScrollArea className="h-full absolute inset-0">
            {tokens.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-zinc-600">
                {t("activity.waiting") || "Waiting for the first token…"}
              </p>
            ) : (
              <ul className="divide-y divide-zinc-800/60">
                {tokens.map((token) => (
                  <TokenRow key={token.mint} token={token} t={t} />
                ))}
              </ul>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </aside>
  );
}
