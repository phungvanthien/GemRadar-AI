// Plain settings persistence — no Next.js dependency, so server-side trade
// modules and the standalone trade-worker can read/write the same
// gemradar-settings.json the API route serves. The route imports its types
// and loader from here; the HTTP layer stays in the route.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const SETTINGS_PATH = path.join(process.cwd(), "gemradar-settings.json");

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
  // POST-MORTEM tuning. Two changes from the first live run:
  //  - stopLossPercent was 0 (DISABLED), so SIP sold at -99.5% with no floor.
  //    A real stop-loss, paired with the 20s exit loop, caps the downside.
  //  - the ladder opened at 2x and sold 50%, cutting POKEMON's run off right as
  //    it was the one winner the gem thesis depends on. First tier is now 3x
  //    with a smaller clip and a larger moon bag so the 10x tail can run.
  sellStrategy: {
    enabled: true,
    mode: "ladder",
    tiers: [
      { id: "t3", multiplier: 3, sellPercent: 35 },
      { id: "t5", multiplier: 5, sellPercent: 15 },
      { id: "t8", multiplier: 8, sellPercent: 10 },
      { id: "t10", multiplier: 10, sellPercent: 10 },
    ],
    singleTargetMultiplier: 3,
    trailingStopPercent: 20,
    trailingActivateMultiplier: 2,
    stopLossPercent: 35,
    maxHoldMinutes: 0,
    manualHoldPercent: 20,
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
