// Mandate capital accounting + entry-gate decision. PURE and chain-free so the
// whole thing is unit-testable without a network or filesystem (mirrors the
// decideSells / assert* split in trade-exit.ts / trade-wallet.ts).
//
// The mandate is the SINGLE SOURCE OF TRUTH for "how much SOL is entrusted to
// hunt gems". It sits ABOVE the existing swap/guard layer: nothing here signs or
// touches the chain — it only decides sizing and whether a new entry is allowed.
// The real-money gate (canTradeLive) and the per-trade guards (assertUnderMaxSol,
// assertBalanceFloorOk, ...) still run underneath, unchanged.

export type MandateStatus = "active" | "paused" | "stopped";

export type DrawdownBreachAction = "halt" | "halt-and-liquidate";

export interface Mandate {
  status: MandateStatus;
  // Entrusted principal (SOL). The reference for every sizing & risk computation.
  principalSol: number;
  // Start of the current mandate session (ISO).
  startedAt: string;

  // ── Allocation / sizing ────────────────────────────────────────────
  // % of principal committed per position (e.g. 10 => each buy spends 10%).
  perTradePctOfPrincipal: number;
  // SOL always kept uninvested inside the mandate (gas + buffer).
  reserveSol: number;
  // Ceiling on simultaneously-open positions.
  maxOpenPositions: number;

  // ── Portfolio-level risk ────────────────────────────────────────────
  // Halt new entries when equity drops to <= -maxDrawdownPct% of principal.
  maxDrawdownPct: number;
  // Halt new entries for the day when realized P&L for the UTC day drops to
  // <= -dailyLossLimitPct% of principal.
  dailyLossLimitPct: number;
  // On a drawdown breach: only stop opening, or also liquidate everything.
  onDrawdownBreach: DrawdownBreachAction;

  updatedAt: string;
}

export const DEFAULT_MANDATE: Mandate = {
  status: "stopped",
  principalSol: 1,
  startedAt: new Date(0).toISOString(),
  perTradePctOfPrincipal: 10,
  reserveSol: 0.05, // matches TRADE_MIN_WALLET_SOL default
  maxOpenPositions: 5,
  maxDrawdownPct: 25,
  dailyLossLimitPct: 15,
  onDrawdownBreach: "halt",
  updatedAt: new Date(0).toISOString(),
};

export interface MandateAccounting {
  principalSol: number;
  deployedSol: number; // Σ entrySol of open positions (capital "in the market")
  availableSol: number; // principal - deployed - reserve, floored at 0
  realizedPnlSol: number;
  unrealizedPnlSol: number;
  equitySol: number; // principal + realized + unrealized
  // (equity - principal) / principal * 100. Negative = loss. 0 when principal<=0.
  drawdownPct: number;
  // principal * perTradePct/100, then clamped to availableSol and maxSolPerTrade.
  perTradeSizeSol: number;
}

export interface AccountingInput {
  mandate: Mandate;
  deployedSol: number;
  realizedPnlSol: number;
  unrealizedPnlSol: number;
  // The per-trade hard cap from trade-config (maxSolPerTrade). The computed size
  // is clamped to this so the mandate can never size a buy above the operator cap.
  maxSolPerTrade: number;
}

export function computeAccounting(input: AccountingInput): MandateAccounting {
  const { mandate, deployedSol, realizedPnlSol, unrealizedPnlSol, maxSolPerTrade } = input;
  const principalSol = Math.max(0, mandate.principalSol);

  const availableSol = Math.max(
    0,
    principalSol - Math.max(0, deployedSol) - Math.max(0, mandate.reserveSol),
  );

  const equitySol = principalSol + realizedPnlSol + unrealizedPnlSol;
  const drawdownPct =
    principalSol > 0 ? ((equitySol - principalSol) / principalSol) * 100 : 0;

  const rawSize = principalSol * (mandate.perTradePctOfPrincipal / 100);
  const perTradeSizeSol = Math.max(
    0,
    Math.min(rawSize, availableSol, maxSolPerTrade),
  );

  return {
    principalSol,
    deployedSol: Math.max(0, deployedSol),
    availableSol,
    realizedPnlSol,
    unrealizedPnlSol,
    equitySol,
    drawdownPct,
    perTradeSizeSol,
  };
}

export type EntryGateReason =
  | "ok"
  | "mandate-not-active"
  | "drawdown-breach"
  | "daily-loss-limit"
  | "max-open-reached"
  | "insufficient-available";

export interface EntryGateInput {
  mandate: Mandate;
  acct: MandateAccounting;
  openCount: number;
  // Realized P&L accrued during the current UTC day (SOL). Negative = loss today.
  realizedTodaySol: number;
}

export interface EntryGateResult {
  allowed: boolean;
  reason: EntryGateReason;
  sizeSol: number;
  // True only when a drawdown breach occurred AND the mandate says liquidate.
  // The exit engine reads this to force-close open positions this tick.
  liquidate: boolean;
}

// Decide whether a NEW position may be opened, fail-first. Pure.
export function evaluateEntryGate(input: EntryGateInput): EntryGateResult {
  const { mandate, acct, openCount, realizedTodaySol } = input;

  if (mandate.status !== "active") {
    return { allowed: false, reason: "mandate-not-active", sizeSol: 0, liquidate: false };
  }

  // Drawdown breach: equity has fallen to/below the drawdown floor.
  const drawdownBreached = acct.drawdownPct <= -Math.abs(mandate.maxDrawdownPct);
  if (drawdownBreached) {
    return {
      allowed: false,
      reason: "drawdown-breach",
      sizeSol: 0,
      liquidate: mandate.onDrawdownBreach === "halt-and-liquidate",
    };
  }

  // Daily loss limit on REALIZED P&L for the day.
  const dailyFloorSol = -(acct.principalSol * (mandate.dailyLossLimitPct / 100));
  if (realizedTodaySol <= dailyFloorSol) {
    return { allowed: false, reason: "daily-loss-limit", sizeSol: 0, liquidate: false };
  }

  if (openCount >= mandate.maxOpenPositions) {
    return { allowed: false, reason: "max-open-reached", sizeSol: 0, liquidate: false };
  }

  // Must have enough uninvested capital to fund a full-size buy.
  if (acct.perTradeSizeSol <= 0 || acct.perTradeSizeSol > acct.availableSol + 1e-9) {
    return { allowed: false, reason: "insufficient-available", sizeSol: 0, liquidate: false };
  }

  return { allowed: true, reason: "ok", sizeSol: acct.perTradeSizeSol, liquidate: false };
}

// Does the current portfolio state trigger a forced liquidation this tick?
// Used by the exit engine independently of entry (a breach must liquidate even
// when no new entry is attempted). Pure.
export function shouldForceLiquidate(mandate: Mandate, acct: MandateAccounting): boolean {
  if (mandate.onDrawdownBreach !== "halt-and-liquidate") return false;
  return acct.drawdownPct <= -Math.abs(mandate.maxDrawdownPct);
}
