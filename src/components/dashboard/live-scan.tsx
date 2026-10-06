"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Activity, Loader2, Target, AlertTriangle, CheckCircle2, Play, Timer } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/i18n/context";

const AUTO_SCAN_INTERVAL = 120; // seconds

export function LiveScan() {
  const { t } = useLanguage();
  const [state, setState] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(AUTO_SCAN_INTERVAL);
  const mountedRef = useRef(true);
  const countdownRef = useRef(AUTO_SCAN_INTERVAL);

  useEffect(() => {
    mountedRef.current = true;
    const fetchState = async () => {
      try {
        const res = await fetch("/api/live-scan");
        const data = await res.json();
        if (!mountedRef.current) return;
        if (!res.ok) throw new Error(data.error ?? "Failed to load");
        setState(data);
        setError(null);
      } catch (e) {
        if (mountedRef.current) setError(e instanceof Error ? e.message : "Error");
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };

    fetchState();
    const interval = setInterval(fetchState, 3000);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, []);

  const isBusy = scanning || state?.status === "scanning" || state?.status === "analyzing";

  const runScan = useCallback(async () => {
    if (!mountedRef.current) return;
    setScanning(true);
    setScanMsg(null);
    try {
      const res = await fetch("/api/solana-gems", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json();
      if (!mountedRef.current) return;
      if (!res.ok) throw new Error(data.error ?? "Scan failed");
      if (data.message) setScanMsg(data.message);
    } catch (e) {
      if (mountedRef.current)
        setScanMsg(e instanceof Error ? e.message : "Scan failed");
    } finally {
      if (mountedRef.current) setScanning(false);
    }
  }, []);

  // Auto-scan countdown — ticks every second, fires scan at 0, then resets.
  useEffect(() => {
    countdownRef.current = AUTO_SCAN_INTERVAL;
    setCountdown(AUTO_SCAN_INTERVAL);

    const tick = setInterval(() => {
      if (!mountedRef.current) return;
      countdownRef.current -= 1;
      setCountdown(countdownRef.current);
      if (countdownRef.current <= 0) {
        countdownRef.current = AUTO_SCAN_INTERVAL;
        setCountdown(AUTO_SCAN_INTERVAL);
        runScan();
      }
    }, 1000);

    return () => clearInterval(tick);
  }, [runScan]);

  // Manual scan: also resets the countdown so the auto-scan starts fresh.
  function handleScanNow() {
    if (isBusy) return;
    countdownRef.current = AUTO_SCAN_INTERVAL;
    setCountdown(AUTO_SCAN_INTERVAL);
    runScan();
  }

  // Progress bar: full at 120s, empty at 0s.
  const progressPct = (countdown / AUTO_SCAN_INTERVAL) * 100;

  const getStatusColor = (status: string) => {
    switch (status) {
      case "scanning":
      case "analyzing":
        return "text-blue-400";
      case "completed":
        return "text-emerald-400";
      case "error":
        return "text-red-400";
      default:
        return "text-zinc-500";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "scanning":
      case "analyzing":
        return <Loader2 className="size-4 animate-spin text-blue-400" />;
      case "completed":
        return <CheckCircle2 className="size-4 text-emerald-400" />;
      case "error":
        return <AlertTriangle className="size-4 text-red-400" />;
      default:
        return <Activity className="size-4 text-zinc-500" />;
    }
  };

  return (
    <Card className="flex flex-1 flex-col border-blue-500/10 overflow-hidden h-full">
      <CardHeader className="border-b border-zinc-800/80 pb-3 space-y-0 gap-0">
        {/* Row 1: title + scan button */}
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-blue-400">
            <Target className="size-4" />
            {t("scan.title") || "Bot Scan Status"}
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            disabled={isBusy}
            onClick={handleScanNow}
            className="h-7 px-2.5 text-[11px] border-blue-500/30 text-blue-400 hover:bg-blue-500/10 hover:text-blue-300 disabled:opacity-50"
          >
            {isBusy ? (
              <Loader2 className="size-3 animate-spin mr-1" />
            ) : (
              <Play className="size-3 mr-1" />
            )}
            {isBusy ? (t("scan.scanning") || "Scanning…") : (t("scan.scanNow") || "Scan Now")}
          </Button>
        </div>

        {/* Row 2: status + last-updated */}
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            {state && getStatusIcon(state.status)}
            <span className={`capitalize ${state ? getStatusColor(state.status) : ""}`}>
              {state ? (t(`scan.status_${state.status}`) || state.status) : (t("common.loading") || "Loading...")}
            </span>
          </div>
          {state?.updatedAt && (
            <span className="text-[10px] text-zinc-600">
              {new Date(state.updatedAt).toLocaleTimeString()}
            </span>
          )}
        </div>

        {/* Row 3: auto-scan countdown bar */}
        <div className="mt-2.5">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1 text-[10px] text-zinc-600">
              <Timer className="size-3" />
              <span>{t("scan.autoScan") || "Auto scan"}</span>
            </div>
            <span className="text-[10px] tabular-nums text-zinc-500">
              {isBusy ? (t("scan.scanning") || "Scanning…") : `${countdown}s`}
            </span>
          </div>
          <div className="h-1 w-full rounded-full bg-zinc-800 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-1000 ease-linear ${isBusy ? "bg-blue-500 animate-pulse" : "bg-blue-500/60"}`}
              style={{ width: isBusy ? "100%" : `${progressPct}%` }}
            />
          </div>
        </div>

        {scanMsg && (
          <p className="mt-2 text-[11px] text-amber-400/80 leading-snug">{scanMsg}</p>
        )}
      </CardHeader>
      <CardContent className="flex-1 p-0 relative">
        <ScrollArea className="h-full absolute inset-0">
          {!state ? (
            <div className="p-4 text-center text-xs text-zinc-500">{t("common.connecting") || "Connecting..."}</div>
          ) : error ? (
            <div className="p-4 text-center text-xs text-red-400">{error}</div>
          ) : state.tokens?.length === 0 ? (
            <div className="p-4 text-center text-xs text-zinc-500">
              <div className="mb-3">{t("scan.noTokens") || "No tokens currently being scanned."}</div>
              <div className="text-zinc-600">{t("scan.scanNowHint") || "Press \"Scan Now\" above to scan the latest mints from the Live Feed."}</div>
            </div>
          ) : (
            <ul className="divide-y divide-zinc-800/60">
              {state.tokens.map((token: any) => {
                const result = state.results?.find((r: any) => r.mint === token.mint);
                const enriched = state.enrichedInputs?.find((r: any) => r.onChain?.mint === token.mint);

                return (
                  <li key={token.mint} className="p-3 transition-colors hover:bg-zinc-800/30">
                    <div className="flex items-center justify-between mb-1">
                      <div className="font-semibold text-zinc-100 text-sm flex items-center gap-2">
                        <span>{token.symbol || "Unknown"}</span>
                        {result?.aiAnalyzed === false ? (
                          <Badge variant="default" className="text-[9px] py-0 px-1.5 bg-zinc-500/10 text-zinc-400 border-zinc-500/20 font-normal">
                            {t("scan.gemScoreOnly") || "Chỉ GemScore (không AI)"}
                          </Badge>
                        ) : result ? (
                          <Badge variant="default" className="text-[9px] py-0 px-1.5 bg-emerald-500/10 text-emerald-400 border-emerald-500/20 font-normal">
                            {t("scan.reviewed") || "Đã Review Xong"}
                          </Badge>
                        ) : enriched ? (
                          <Badge variant="default" className="text-[9px] py-0 px-1.5 bg-blue-500/10 text-blue-400 border-blue-500/20 font-normal">
                            <Loader2 className="size-2.5 animate-spin mr-1" /> {t("scan.aiChecking") || "Đang AI Check"}
                          </Badge>
                        ) : (
                          <Badge variant="default" className="text-[9px] py-0 px-1.5 bg-zinc-500/10 text-zinc-400 border-zinc-500/20 font-normal">
                            {t("scan.newlyDetected") || "Mới Phát Hiện"}
                          </Badge>
                        )}
                      </div>
                      {result?.gemScore != null && (
                        <Badge
                          variant={result.gemScore >= 8 ? "success" : result.gemScore >= 5 ? "default" : "muted"}
                          className="text-[10px]"
                        >
                          {t("scan.score") || "Score"}: {result.gemScore}/10
                        </Badge>
                      )}
                    </div>
                    <div className="text-[10px] text-zinc-500 font-mono mb-2">
                      {token.mint.slice(0, 6)}...{token.mint.slice(-4)}
                    </div>

                    {result && (
                      <div className="space-y-1 mt-2 bg-zinc-900/50 p-2 rounded text-xs">
                        <div className="flex justify-between">
                          <span className="text-zinc-400">{t("scan.totalBaseScore") || "Total Base Score"}:</span>
                          <span className="text-zinc-200">{result.breakdown?.total ?? 0}/100</span>
                        </div>
                        {result.aiAnalyzed !== false && result.riskScore != null && (
                          <div className="flex justify-between">
                            <span className="text-zinc-400">{t("scan.riskScore") || "Risk Score"}:</span>
                            <span className="text-zinc-200">{result.riskScore}/10</span>
                          </div>
                        )}
                        {result.explanation && (
                          <p className="text-zinc-300 mt-1 line-clamp-2 italic border-l-2 border-zinc-700 pl-2">
                            &quot;{result.explanation}&quot;
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
