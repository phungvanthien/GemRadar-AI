// Persistent store for the capital mandate. Mirrors position-store.ts /
// settings-store.ts: a single JSON file written atomically (temp + rename) so a
// mid-write worker tick never reads a half-written file. Next-free so the
// standalone trade-worker and the API route share one source of truth.
//
// This holds ONLY the mandate configuration/state — never the wallet secret
// (that stays in env, read by trade-wallet.ts). Add alphahunter-mandate.json to
// .gitignore: it is runtime state, like positions/settings.

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_MANDATE, type Mandate, type MandateStatus } from "./mandate";

const STORE_PATH = path.join(process.cwd(), "alphahunter-mandate.json");

// Coerce a partial/untrusted on-disk record into a valid Mandate, clamping every
// numeric field to a sane range. A corrupt or missing file yields DEFAULT_MANDATE.
function sanitize(raw: Partial<Mandate>): Mandate {
  const clamp = (v: unknown, lo: number, hi: number, fallback: number): number => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(hi, Math.max(lo, n));
  };
  const validStatus: MandateStatus[] = ["active", "paused", "stopped"];
  const status = validStatus.includes(raw.status as MandateStatus)
    ? (raw.status as MandateStatus)
    : DEFAULT_MANDATE.status;

  return {
    status,
    principalSol: clamp(raw.principalSol, 0, 100000, DEFAULT_MANDATE.principalSol),
    startedAt:
      typeof raw.startedAt === "string" && raw.startedAt
        ? raw.startedAt
        : DEFAULT_MANDATE.startedAt,
    perTradePctOfPrincipal: clamp(
      raw.perTradePctOfPrincipal,
      1,
      100,
      DEFAULT_MANDATE.perTradePctOfPrincipal,
    ),
    reserveSol: clamp(raw.reserveSol, 0, 100000, DEFAULT_MANDATE.reserveSol),
    maxOpenPositions: Math.round(
      clamp(raw.maxOpenPositions, 1, 1000, DEFAULT_MANDATE.maxOpenPositions),
    ),
    maxDrawdownPct: clamp(raw.maxDrawdownPct, 1, 100, DEFAULT_MANDATE.maxDrawdownPct),
    dailyLossLimitPct: clamp(
      raw.dailyLossLimitPct,
      1,
      100,
      DEFAULT_MANDATE.dailyLossLimitPct,
    ),
    onDrawdownBreach:
      raw.onDrawdownBreach === "halt-and-liquidate" ? "halt-and-liquidate" : "halt",
    updatedAt:
      typeof raw.updatedAt === "string" && raw.updatedAt
        ? raw.updatedAt
        : DEFAULT_MANDATE.updatedAt,
  };
}

export async function loadMandate(): Promise<Mandate> {
  try {
    const raw = JSON.parse(await readFile(STORE_PATH, "utf8")) as Partial<Mandate>;
    return sanitize(raw);
  } catch {
    return { ...DEFAULT_MANDATE };
  }
}

async function writeStore(mandate: Mandate): Promise<void> {
  await mkdir(path.dirname(STORE_PATH), { recursive: true });
  const tmp = `${STORE_PATH}.tmp`;
  await writeFile(tmp, JSON.stringify(mandate, null, 2), "utf8");
  await rename(tmp, STORE_PATH);
}

// Replace the whole mandate (used by the API route after sanitizing a client
// payload). Stamps updatedAt. Returns the persisted record.
export async function saveMandate(
  next: Omit<Mandate, "updatedAt">,
  now = new Date(),
): Promise<Mandate> {
  const persisted = sanitize({ ...next, updatedAt: now.toISOString() });
  await writeStore(persisted);
  return persisted;
}

// Merge a partial patch onto the current mandate (used by pause/resume/stop and
// field edits). Stamps updatedAt.
export async function patchMandate(
  patch: Partial<Mandate>,
  now = new Date(),
): Promise<Mandate> {
  const current = await loadMandate();
  const merged = sanitize({ ...current, ...patch, updatedAt: now.toISOString() });
  await writeStore(merged);
  return merged;
}

// Transition helpers — the only sanctioned way to move status. `resume` restamps
// startedAt so reporting windows (e.g. daily loss) begin at the resume point.
export async function setMandateStatus(
  status: MandateStatus,
  now = new Date(),
): Promise<Mandate> {
  const patch: Partial<Mandate> = { status };
  if (status === "active") patch.startedAt = now.toISOString();
  return patchMandate(patch, now);
}
