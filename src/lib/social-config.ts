// Loads social-monitor.config.json — the behavior config for tracking the social
// presence of high-scoring gems. NO secrets live here (those are in .env.local);
// this is thresholds, rate limits, and which platforms are enabled.
//
// Server-only (node:fs). Reads once and caches. A missing or malformed file
// degrades to safe defaults so a scan never breaks over config.

import { readFileSync } from "node:fs";
import path from "node:path";

export interface SocialThresholds {
  minGemScoreAi: number; // AI gemScore /10 floor
  minGemScoreTotal: number; // deterministic total /100 floor
  minCoverage: number; // 0-1, require at least this data coverage
}

export interface TelegramMonitorConfig {
  enabled: boolean;
  maxJoinsPerRun: number;
  minJoinDelaySeconds: number;
  maxJoinDelaySeconds: number;
  historySampleSize: number;
  leaveOnStatus: string[];
  leaveAfterHoursIfBelowScore: number;
  leaveScoreFloor: number;
}

export interface XMonitorConfig {
  enabled: boolean;
  source: "official" | "none";
  minFollowers: number;
  maxAccountAgeDaysForCaution: number;
  trackKeywords: string[];
  pollIntervalMinutes: number;
  maxAccountsPerRun: number;
}

export interface WatchlistConfig {
  maxTrackedTokens: number;
  trackTtlHours: number;
}

// Spam filter thresholds loaded from spamFilter block in the config file.
export interface SpamFilterTelegramConfig {
  minOnlineRatioPct: number;
  maxMsgRatePerMemberPerHour: number;
  maxForwardedSharePct: number;
  maxAnonymousSharePct: number;
  maxContractSharePct: number;
  minUniqueSenderRatioPct: number;
}

export interface SpamFilterXConfig {
  maxFollowingFollowerRatio: number;
  minAvgEngagementForActive: number;
  maxTweetsPerDay: number;
  newAccountDaysHard: number;
  newAccountDaysSoft: number;
}

export interface SpamFilterConfig {
  /** Authenticity score below this → treat as spam (0-100, default 30). */
  botThreshold: number;
  telegram: SpamFilterTelegramConfig;
  x: SpamFilterXConfig;
}

export interface SocialMonitorConfig {
  thresholds: SocialThresholds;
  telegram: TelegramMonitorConfig;
  x: XMonitorConfig;
  watchlist: WatchlistConfig;
  spamFilter: SpamFilterConfig;
}

const CONFIG_PATH = path.join(process.cwd(), "social-monitor.config.json");

// Safe defaults, used when the file is absent or a field is missing/invalid.
const DEFAULTS: SocialMonitorConfig = {
  thresholds: { minGemScoreAi: 7, minGemScoreTotal: 70, minCoverage: 0.7 },
  telegram: {
    enabled: false,
    maxJoinsPerRun: 3,
    minJoinDelaySeconds: 45,
    maxJoinDelaySeconds: 120,
    historySampleSize: 100,
    leaveOnStatus: ["fail", "sold"],
    leaveAfterHoursIfBelowScore: 48,
    leaveScoreFloor: 30,
  },
  x: {
    enabled: false,
    source: "none",
    minFollowers: 500,
    maxAccountAgeDaysForCaution: 14,
    trackKeywords: [],
    pollIntervalMinutes: 30,
    maxAccountsPerRun: 5,
  },
  watchlist: { maxTrackedTokens: 50, trackTtlHours: 72 },
  spamFilter: {
    botThreshold: 30,
    telegram: {
      minOnlineRatioPct: 0.5,
      maxMsgRatePerMemberPerHour: 1.0,
      maxForwardedSharePct: 40,
      maxAnonymousSharePct: 30,
      maxContractSharePct: 50,
      minUniqueSenderRatioPct: 5,
    },
    x: {
      maxFollowingFollowerRatio: 20,
      minAvgEngagementForActive: 0.5,
      maxTweetsPerDay: 100,
      newAccountDaysHard: 7,
      newAccountDaysSoft: 30,
    },
  },
};

const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;
const bool = (v: unknown, fallback: boolean): boolean =>
  typeof v === "boolean" ? v : fallback;
const strArr = (v: unknown, fallback: string[]): string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : fallback;

let cached: SocialMonitorConfig | null = null;

// Read + validate the config, merging over defaults. Cached after first read.
export function getSocialMonitorConfig(): SocialMonitorConfig {
  if (cached) return cached;

  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Record<string, unknown>;
  } catch {
    // Absent/malformed — use defaults wholesale.
    cached = DEFAULTS;
    return cached;
  }

  const t = (raw.thresholds ?? {}) as Record<string, unknown>;
  const tg = (raw.telegram ?? {}) as Record<string, unknown>;
  const x = (raw.x ?? {}) as Record<string, unknown>;
  const wl = (raw.watchlist ?? {}) as Record<string, unknown>;
  const sf = (raw.spamFilter ?? {}) as Record<string, unknown>;
  const sfTg = (sf.telegram ?? {}) as Record<string, unknown>;
  const sfX = (sf.x ?? {}) as Record<string, unknown>;
  const D = DEFAULTS;

  cached = {
    thresholds: {
      minGemScoreAi: num(t.minGemScoreAi, D.thresholds.minGemScoreAi),
      minGemScoreTotal: num(t.minGemScoreTotal, D.thresholds.minGemScoreTotal),
      minCoverage: num(t.minCoverage, D.thresholds.minCoverage),
    },
    telegram: {
      enabled: bool(tg.enabled, D.telegram.enabled),
      maxJoinsPerRun: num(tg.maxJoinsPerRun, D.telegram.maxJoinsPerRun),
      minJoinDelaySeconds: num(tg.minJoinDelaySeconds, D.telegram.minJoinDelaySeconds),
      maxJoinDelaySeconds: num(tg.maxJoinDelaySeconds, D.telegram.maxJoinDelaySeconds),
      historySampleSize: num(tg.historySampleSize, D.telegram.historySampleSize),
      leaveOnStatus: strArr(tg.leaveOnStatus, D.telegram.leaveOnStatus),
      leaveAfterHoursIfBelowScore: num(
        tg.leaveAfterHoursIfBelowScore,
        D.telegram.leaveAfterHoursIfBelowScore,
      ),
      leaveScoreFloor: num(tg.leaveScoreFloor, D.telegram.leaveScoreFloor),
    },
    x: {
      enabled: bool(x.enabled, D.x.enabled),
      source: x.source === "official" ? "official" : "none",
      minFollowers: num(x.minFollowers, D.x.minFollowers),
      maxAccountAgeDaysForCaution: num(
        x.maxAccountAgeDaysForCaution,
        D.x.maxAccountAgeDaysForCaution,
      ),
      trackKeywords: strArr(x.trackKeywords, D.x.trackKeywords),
      pollIntervalMinutes: num(x.pollIntervalMinutes, D.x.pollIntervalMinutes),
      maxAccountsPerRun: num(x.maxAccountsPerRun, D.x.maxAccountsPerRun),
    },
    watchlist: {
      maxTrackedTokens: num(wl.maxTrackedTokens, D.watchlist.maxTrackedTokens),
      trackTtlHours: num(wl.trackTtlHours, D.watchlist.trackTtlHours),
    },
    spamFilter: {
      botThreshold: num(sf.botThreshold, D.spamFilter.botThreshold),
      telegram: {
        minOnlineRatioPct: num(sfTg.minOnlineRatioPct, D.spamFilter.telegram.minOnlineRatioPct),
        maxMsgRatePerMemberPerHour: num(sfTg.maxMsgRatePerMemberPerHour, D.spamFilter.telegram.maxMsgRatePerMemberPerHour),
        maxForwardedSharePct: num(sfTg.maxForwardedSharePct, D.spamFilter.telegram.maxForwardedSharePct),
        maxAnonymousSharePct: num(sfTg.maxAnonymousSharePct, D.spamFilter.telegram.maxAnonymousSharePct),
        maxContractSharePct: num(sfTg.maxContractSharePct, D.spamFilter.telegram.maxContractSharePct),
        minUniqueSenderRatioPct: num(sfTg.minUniqueSenderRatioPct, D.spamFilter.telegram.minUniqueSenderRatioPct),
      },
      x: {
        maxFollowingFollowerRatio: num(sfX.maxFollowingFollowerRatio, D.spamFilter.x.maxFollowingFollowerRatio),
        minAvgEngagementForActive: num(sfX.minAvgEngagementForActive, D.spamFilter.x.minAvgEngagementForActive),
        maxTweetsPerDay: num(sfX.maxTweetsPerDay, D.spamFilter.x.maxTweetsPerDay),
        newAccountDaysHard: num(sfX.newAccountDaysHard, D.spamFilter.x.newAccountDaysHard),
        newAccountDaysSoft: num(sfX.newAccountDaysSoft, D.spamFilter.x.newAccountDaysSoft),
      },
    },
  };
  return cached;
}

// Whether a scanned gem is "high-scoring enough" to track on social — both the
// AI gemScore and the deterministic total must clear their thresholds, and the
// deterministic score must be backed by enough data (coverage).
export function shouldTrackSocial(params: {
  gemScoreAi: number;
  gemScoreTotal: number;
  coverage: number;
}): boolean {
  const { thresholds } = getSocialMonitorConfig();
  return (
    params.gemScoreAi >= thresholds.minGemScoreAi &&
    params.gemScoreTotal >= thresholds.minGemScoreTotal &&
    params.coverage >= thresholds.minCoverage
  );
}

