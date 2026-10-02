// Append-only audit trail for mandate changes. Every state transition and field
// edit the operator makes through the API is recorded here, so there is a
// durable record of who changed the entrusted-capital config and when. Server-
// only; never records the wallet secret (the mandate holds no secret anyway).
//
// One JSON object per line (JSONL) appended atomically-enough for an audit log:
// a single appendFile with a trailing newline. The file is gitignored.

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

const AUDIT_PATH = path.join(process.cwd(), "alphahunter-mandate-audit.log");

export interface MandateAuditEntry {
  time: string; // ISO
  action: string; // "update" | "pause" | "resume" | "stop" | "stop-liquidate"
  // Human-readable summary of what changed (e.g. "principalSol 5 -> 10").
  changes: string[];
}

// Best-effort: an audit-write failure must never fail the operation it records.
export async function recordMandateAudit(
  entry: Omit<MandateAuditEntry, "time">,
  now = new Date(),
): Promise<void> {
  try {
    await mkdir(path.dirname(AUDIT_PATH), { recursive: true });
    const line = JSON.stringify({ time: now.toISOString(), ...entry }) + "\n";
    await appendFile(AUDIT_PATH, line, "utf8");
  } catch (e) {
    console.error("[mandate-audit] failed to write audit entry:", e);
  }
}

// Diff two mandates into a list of "field a -> b" strings for the audit log.
// Only compares the fields an operator can change.
export function diffMandate(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const fields = [
    "status",
    "principalSol",
    "perTradePctOfPrincipal",
    "reserveSol",
    "maxOpenPositions",
    "maxDrawdownPct",
    "dailyLossLimitPct",
    "onDrawdownBreach",
  ];
  const changes: string[] = [];
  for (const f of fields) {
    if (before[f] !== after[f]) {
      changes.push(`${f} ${String(before[f])} -> ${String(after[f])}`);
    }
  }
  return changes;
}
