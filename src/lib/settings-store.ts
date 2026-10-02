// Plain settings persistence — no Next.js dependency, so server-side trade
// modules and the standalone trade-worker can read/write the same
// alphahunter-settings.json the API route serves. The route imports its types
// and loader from here; the HTTP layer stays in the route.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const SETTINGS_PATH = path.join(process.cwd(), "alphahunter-settings.json");

export interface TradingSettings {
  buyVolumeSol: number;
  autoBuyEnabled: boolean;
  minGemScoreToTrigger: number;
  telegramAccounts: TelegramAccount[];
  xAccounts: XAccount[];
  socialWeights: { telegram: number; x: number };
  sellStrategy: SellStrategy;
  updatedAt: string;
}

export interface TakeProfitTier {
  id: string;
  multiplier: number;
  sellPercent: number;
}

export type SellMode = "ladder" | "single" | "trailing" | "manual";

export interface SellStrategy {
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

export interface TelegramAccount {
  id: string;
  username: string;
  label: string;
  enabled: boolean;
}

export interface XAccount {
  id: string;
  handle: string;
  label: string;
  enabled: boolean;
}

export const DEFAULT_SETTINGS: TradingSettings = {
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
  updatedAt: new Date().toISOString(),
};

export function loadSettings(): TradingSettings {
  if (!existsSync(SETTINGS_PATH)) return DEFAULT_SETTINGS;
  try {
    const raw = JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) as Partial<TradingSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...raw,
      socialWeights: { ...DEFAULT_SETTINGS.socialWeights, ...(raw.socialWeights ?? {}) },
      sellStrategy: {
        ...DEFAULT_SETTINGS.sellStrategy,
        ...(raw.sellStrategy ?? {}),
        tiers: Array.isArray(raw.sellStrategy?.tiers)
          ? raw.sellStrategy!.tiers
          : DEFAULT_SETTINGS.sellStrategy.tiers,
      },
      telegramAccounts: Array.isArray(raw.telegramAccounts) ? raw.telegramAccounts : [],
      xAccounts: Array.isArray(raw.xAccounts) ? raw.xAccounts : [],
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: TradingSettings): void {
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf8");
}
