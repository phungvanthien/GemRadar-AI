"use client";

import { useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  AlertTriangle,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/i18n/context";
import { format } from "date-fns";
import { vi } from "date-fns/locale";

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

function fmtSol(v: number, digits = 4): string {
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)} SOL`;
}

function fmtUsd(sol: number, solPriceUsd: number | null): string | null {
  if (solPriceUsd == null) return null;
  const usd = sol * solPriceUsd;
  const sign = usd > 0 ? "+" : "";
  return `${sign}$${Math.abs(usd).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function fmtPrice(v: number): string {
  if (v === 0) return "—";
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: v < 1 ? 8 : 2 })}`;
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return format(d, "dd/MM HH:mm", { locale: vi });
  } catch {
    return iso;
  }
}

function shortMint(mint: string): string {
  if (!mint) return "";
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

function pnlColor(v: number): string {
  if (v > 0) return "text-emerald-400";
  if (v < 0) return "text-red-400";
  return "text-zinc-400";
}

export function GemRow({
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
        </td>
      </tr>
      {open && (
        <tr className="border-t border-zinc-800/40 bg-zinc-950/40">
          <td colSpan={5} className="px-4 py-3">
            {gem.status === "open" && (
              <div className="mb-3 flex items-center justify-between rounded-lg border border-amber-500/20 bg-amber-950/10 px-3 py-2">
                <p className="text-xs text-zinc-400">
                  {t("portfolio.writeOffDesc") || "Token bị rugpull? Ghi mất vị thế để giải phóng slot."}
                </p>
                {confirmAbandon ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onAbandon(gem.id);
                        setConfirmAbandon(false);
                      }}
                      disabled={abandoning}
                      className="flex items-center gap-1.5 rounded-lg bg-red-500/90 px-2.5 py-1.5 text-[11px] font-semibold text-white"
                    >
                      {abandoning ? <RefreshCw className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                      {t("portfolio.writeOff") || "Write-off"}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmAbandon(false);
                      }}
                      className="rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-zinc-400"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmAbandon(true);
                    }}
                    disabled={abandoning}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-red-500/30 px-2.5 py-1.5 text-[11px] font-medium text-red-400/80"
                  >
                    <AlertTriangle className="size-3.5" />
                    {t("portfolio.writeOff") || "Ghi mất"}
                  </button>
                )}
              </div>
            )}
            <div className="space-y-1.5">
              {gem.legs?.map((leg, i) => (
                <div key={`${leg.time}-${i}`} className="flex items-center gap-3 rounded-lg bg-zinc-900/50 px-3 py-2 text-xs">
                  <span className="flex items-center gap-1.5">
                    {leg.kind === "buy" ? (
                      <ArrowDownRight className="size-3.5 text-sky-400" />
                    ) : (
                      <ArrowUpRight className="size-3.5 text-emerald-400" />
                    )}
                    <span className="font-medium text-zinc-300">
                      {leg.kind === "buy" ? "Buy" : `Sell ${leg.pct.toFixed(0)}%`}
                    </span>
                  </span>
                  <span className="text-zinc-500 tabular-nums">{fmtTime(leg.time)}</span>
                  <span className="text-zinc-500 tabular-nums">@ {fmtPrice(leg.priceUsd)}</span>
                  <span className="ml-auto flex items-center gap-3 tabular-nums">
                    <span className={leg.solFlow >= 0 ? "text-emerald-400/80" : "text-sky-400/80"}>
                      {leg.solFlow >= 0 ? "+" : ""}{leg.solFlow.toFixed(4)} SOL
                    </span>
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