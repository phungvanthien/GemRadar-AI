import { NextResponse } from "next/server";
import {
  loadSettings,
  saveSettings,
  type TradingSettings,
  type SellStrategy,
  type SellMode,
} from "@/lib/settings-store";

// Re-export the settings types/loaders from the Next-free store so existing
// importers of "@/app/api/settings/route" keep working while server-side trade
// modules can import from "@/lib/settings-store" directly (no Next dependency).
export type {
  TradingSettings,
  SellStrategy,
  SellMode,
  TakeProfitTier,
  TelegramAccount,
  XAccount,
} from "@/lib/settings-store";
export { loadSettings, saveSettings } from "@/lib/settings-store";

function clampNum(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

function sanitizeSellStrategy(
  raw: Partial<SellStrategy> | undefined,
  current: SellStrategy
): SellStrategy {
  const src = raw ?? current;
  const validModes: SellMode[] = ["ladder", "single", "trailing", "manual"];
  const mode = validModes.includes(src.mode as SellMode)
    ? (src.mode as SellMode)
    : current.mode;

  const tiers = Array.isArray(src.tiers)
    ? src.tiers
        .map((t) => ({
          id: typeof t.id === "string" && t.id ? t.id : Math.random().toString(36).slice(2, 9),
          multiplier: clampNum(t.multiplier, 1.1, 1000, 2),
          sellPercent: clampNum(t.sellPercent, 1, 100, 10),
        }))
        .sort((a, b) => a.multiplier - b.multiplier)
    : current.tiers;

  return {
    enabled: typeof src.enabled === "boolean" ? src.enabled : current.enabled,
    mode,
    tiers,
    singleTargetMultiplier: clampNum(src.singleTargetMultiplier, 1.1, 1000, current.singleTargetMultiplier),
    trailingStopPercent: clampNum(src.trailingStopPercent, 1, 90, current.trailingStopPercent),
    trailingActivateMultiplier: clampNum(src.trailingActivateMultiplier, 1, 1000, current.trailingActivateMultiplier),
    stopLossPercent: clampNum(src.stopLossPercent, 0, 99, current.stopLossPercent),
    maxHoldMinutes: clampNum(src.maxHoldMinutes, 0, 100000, current.maxHoldMinutes),
    manualHoldPercent: clampNum(src.manualHoldPercent, 0, 100, current.manualHoldPercent),
  };
}

export async function GET() {
  const settings = loadSettings();
  return NextResponse.json(settings);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<TradingSettings>;

    const current = loadSettings();
    const updated: TradingSettings = {
      ...current,
      ...body,
      buyVolumeSol: Math.min(
        1,
        Math.max(0.05, Number(body.buyVolumeSol ?? current.buyVolumeSol))
      ),
      socialWeights: {
        ...current.socialWeights,
        ...(body.socialWeights ?? {}),
      },
      sellStrategy: sanitizeSellStrategy(body.sellStrategy, current.sellStrategy),
      telegramAccounts: Array.isArray(body.telegramAccounts)
        ? body.telegramAccounts
        : current.telegramAccounts,
      xAccounts: Array.isArray(body.xAccounts)
        ? body.xAccounts
        : current.xAccounts,
      updatedAt: new Date().toISOString(),
    };

    saveSettings(updated);
    return NextResponse.json({ ok: true, settings: updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save settings" },
      { status: 500 }
    );
  }
}
