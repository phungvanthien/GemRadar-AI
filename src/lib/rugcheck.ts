// RugCheck client — third-party token risk scoring for Solana SPL mints.
// See rugcheck-intergration-phase-1.md / phase-2.md. Complements the on-chain
// signals in flux-solana.ts with RugCheck's aggregate risk score, which catches
// patterns we don't compute ourselves (LP locks, insider networks, launchpad
// heuristics). Every call degrades to null on error/missing key so a RugCheck
// outage never sinks the gem pipeline.

const BASE_URL = "https://api.rugcheck.xyz/v1";
const DEFAULT_TIMEOUT_MS = 15_000;

// A single risk flag from a RugCheck report.
export interface RugcheckRisk {
  name: string;
  level: string; // "warn" | "danger" | "info" — RugCheck's own labels
  description: string;
  score: number;
}

// The subset of the summary report we surface to the pipeline. scoreNormalised
// is 0-100 (higher = riskier in RugCheck's scale); we pass it to the AI as-is.
export interface RugcheckSummary {
  mint: string;
  score: number;
  scoreNormalised: number;
  risks: RugcheckRisk[];
}

// A single hit from the token search endpoint. An empty query returns trending
// tokens, so search doubles as a discovery source alongside the gem pipeline.
export interface RugcheckSearchResult {
  mint: string;
  name: string;
  symbol: string;
  scoreNormalised: number;
}

// One of the largest token accounts, from the full report. insider flags an
// account RugCheck has clustered into an insider/creator network.
export interface RugcheckHolder {
  address: string;
  owner: string;
  pct: number; // 0-100, share of supply
  insider: boolean;
}

// An insider/trade network RugCheck detected — coordinated accounts that
// often signal a coming dump. size is the account count in the cluster.
export interface RugcheckInsiderNetwork {
  id: string;
  type: string; // "trade" | "transfer" | ...
  size: number;
  activeAccounts: number;
}

// The fuller report (POST /report). Carries holder concentration, LP lock
// status, and insider networks that the lightweight summary omits — the
// signals worth pulling in for a deeper gem inspection.
export interface RugcheckReport {
  mint: string;
  score: number;
  scoreNormalised: number;
  risks: RugcheckRisk[];
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  totalMarketLiquidity: number;
  lpLockedPct: number | null; // highest LP lock across markets, 0-100; null if no market
  topHolders: RugcheckHolder[];
  insiderNetworks: RugcheckInsiderNetwork[];
}

function apiKey(): string | null {
  return process.env.RUGCHECK_API_KEY ?? null;
}

// Raw shapes are loose because RugCheck's summary is not strictly versioned;
// we read defensively and coerce.
interface RawSummary {
  score?: number;
  score_normalised?: number;
  risks?: Array<{
    name?: string;
    level?: string;
    description?: string;
    score?: number;
  }>;
}

function normalizeSummary(mint: string, raw: RawSummary | null): RugcheckSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const risks = Array.isArray(raw.risks)
    ? raw.risks.map((r) => ({
        name: r.name ?? "unknown",
        level: r.level ?? "info",
        description: r.description ?? "",
        score: typeof r.score === "number" ? r.score : 0,
      }))
    : [];
  return {
    mint,
    score: typeof raw.score === "number" ? raw.score : 0,
    scoreNormalised: typeof raw.score_normalised === "number" ? raw.score_normalised : 0,
    risks,
  };
}

async function fetchJson(
  url: string,
  init: RequestInit,
): Promise<unknown | null> {
  const key = apiKey();
  if (!key) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", "X-API-KEY": key, ...init.headers },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

interface RawSearchResult {
  mint?: string;
  address?: string;
  name?: string;
  symbol?: string;
  score_normalised?: number;
}

// Token search. An empty/blank query returns trending tokens rather than an
// error, matching RugCheck's own behaviour. This endpoint is public (no key
// required), so it degrades to an empty list only on network/parse failure.
export async function searchRugcheckTokens(
  query: string,
  limit = 20,
): Promise<RugcheckSearchResult[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  const trimmed = query.trim();
  if (trimmed) params.set("q", trimmed);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/search?${params}`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return [];
    const raw = await res.json();
    if (!Array.isArray(raw)) return [];
    return (raw as RawSearchResult[]).flatMap((r) => {
      const mint = r.mint ?? r.address;
      if (!mint) return [];
      return [{
        mint,
        name: r.name ?? "",
        symbol: r.symbol ?? "",
        scoreNormalised: typeof r.score_normalised === "number" ? r.score_normalised : 0,
      }];
    });
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

// Single-token summary. Returns null on any failure or when no key is set.
export async function getRugcheckSummary(mint: string): Promise<RugcheckSummary | null> {
  const raw = (await fetchJson(
    `${BASE_URL}/tokens/${mint}/report/summary`,
    { method: "GET" },
  )) as RawSummary | null;
  return normalizeSummary(mint, raw);
}

interface RawReport extends RawSummary {
  token?: { mintAuthority?: string | null; freezeAuthority?: string | null };
  totalMarketLiquidity?: number;
  topHolders?: Array<{
    address?: string;
    owner?: string;
    pct?: number;
    insider?: boolean;
  }>;
  markets?: Array<{ lp?: { lpLockedPct?: number } }>;
  insiderNetworks?: Array<{
    id?: string;
    type?: string;
    size?: number;
    activeAccounts?: number;
  }>;
}

function normalizeReport(mint: string, raw: RawReport | null): RugcheckReport | null {
  if (!raw || typeof raw !== "object") return null;

  const risks = Array.isArray(raw.risks)
    ? raw.risks.map((r) => ({
        name: r.name ?? "unknown",
        level: r.level ?? "info",
        description: r.description ?? "",
        score: typeof r.score === "number" ? r.score : 0,
      }))
    : [];

  const topHolders = Array.isArray(raw.topHolders)
    ? raw.topHolders.flatMap((h) =>
        h.address
          ? [{
              address: h.address,
              owner: h.owner ?? "",
              pct: typeof h.pct === "number" ? h.pct : 0,
              insider: h.insider === true,
            }]
          : [],
      )
    : [];

  const insiderNetworks = Array.isArray(raw.insiderNetworks)
    ? raw.insiderNetworks.map((n) => ({
        id: n.id ?? "",
        type: n.type ?? "unknown",
        size: typeof n.size === "number" ? n.size : 0,
        activeAccounts: typeof n.activeAccounts === "number" ? n.activeAccounts : 0,
      }))
    : [];

  // Highest LP lock across all markets — the strongest lock is what matters
  // for judging rug risk. null when no market data is present.
  const lockPcts = Array.isArray(raw.markets)
    ? raw.markets
        .map((m) => m.lp?.lpLockedPct)
        .filter((p): p is number => typeof p === "number")
    : [];
  const lpLockedPct = lockPcts.length > 0 ? Math.max(...lockPcts) : null;

  // RugCheck reports authorities as an address string, or null/"" when revoked.
  const mintAuth = raw.token?.mintAuthority;
  const freezeAuth = raw.token?.freezeAuthority;

  return {
    mint,
    score: typeof raw.score === "number" ? raw.score : 0,
    scoreNormalised: typeof raw.score_normalised === "number" ? raw.score_normalised : 0,
    risks,
    mintAuthorityRevoked: !mintAuth,
    freezeAuthorityRevoked: !freezeAuth,
    totalMarketLiquidity:
      typeof raw.totalMarketLiquidity === "number" ? raw.totalMarketLiquidity : 0,
    lpLockedPct,
    topHolders,
    insiderNetworks,
  };
}

// Full single-token report. Heavier than the summary — carries holder
// concentration, LP lock status, and insider networks. Returns null on any
// failure or when no key is set. Reserve this for a deeper look at a single
// candidate; the bulk summary is the right tool for scoring the whole batch.
export async function getRugcheckReport(mint: string): Promise<RugcheckReport | null> {
  const raw = (await fetchJson(
    `${BASE_URL}/tokens/${mint}/report`,
    { method: "GET" },
  )) as RawReport | null;
  return normalizeReport(mint, raw);
}

// A node in an insider graph — one account RugCheck clustered into a network.
// participant marks accounts that actively traded/transferred (vs. merely
// linked); holdings is the account's current token balance.
export interface RugcheckInsiderNode {
  id: string;
  participant: boolean;
  holdings: number;
}

// A directed edge between two accounts in an insider graph.
export interface RugcheckInsiderLink {
  source: string;
  target: string;
}

// One connected component of coordinated accounts. netId is stable per network;
// networkType mirrors RugcheckInsiderNetwork.type ("trade" | "transfer" | ...).
export interface RugcheckInsiderGraph {
  netId: string;
  networkType: string;
  nodes: RugcheckInsiderNode[];
  links: RugcheckInsiderLink[];
}

interface RawInsiderGraph {
  networks?: Array<{
    net_id?: string;
    network_type?: string;
    nodes?: Array<{ id?: string; participant?: boolean; holdings?: number }>;
    links?: Array<{ source?: string; target?: string }>;
  }>;
}

// Full account topology for a token's insider networks — the node/link graph
// behind the summary counts in RugcheckReport.insiderNetworks. Reserve this for
// visualising or auditing a single suspicious candidate; it is far heavier than
// the report's aggregate counts. Returns [] on any failure or missing key.
export async function getRugcheckInsiderGraph(
  mint: string,
): Promise<RugcheckInsiderGraph[]> {
  const raw = (await fetchJson(
    `${BASE_URL}/tokens/${mint}/insiders/graph`,
    { method: "GET" },
  )) as RawInsiderGraph | null;
  if (!raw || !Array.isArray(raw.networks)) return [];

  return raw.networks.map((n) => ({
    netId: n.net_id ?? "",
    networkType: n.network_type ?? "unknown",
    nodes: Array.isArray(n.nodes)
      ? n.nodes.flatMap((node) =>
          node.id
            ? [{
                id: node.id,
                participant: node.participant === true,
                holdings: typeof node.holdings === "number" ? node.holdings : 0,
              }]
            : [],
        )
      : [],
    links: Array.isArray(n.links)
      ? n.links.flatMap((link) =>
          link.source && link.target
            ? [{ source: link.source, target: link.target }]
            : [],
        )
      : [],
  }));
}

// Bulk full reports for up to N mints in one request. Returns a map keyed by
// mint; mints RugCheck couldn't report are simply absent. Far heavier than
// getRugcheckSummaryBulk — reach for it only when the batch genuinely needs
// holder concentration, LP locks, and insider networks, not just scores.
// Returns an empty map on total failure or missing key.
export async function getRugcheckReportBulk(
  mints: string[],
): Promise<Map<string, RugcheckReport>> {
  const out = new Map<string, RugcheckReport>();
  if (mints.length === 0) return out;

  const raw = await fetchJson(`${BASE_URL}/bulk/tokens/report`, {
    method: "POST",
    body: JSON.stringify({ tokens: mints }),
  });
  if (!raw) return out;

  // RugCheck's /bulk/tokens/report wraps the array in a { reports: [...] }
  // envelope. Older/other endpoints return a bare array or a { mint: report }
  // map. Unwrap the envelope first, then handle both remaining shapes.
  const payload =
    typeof raw === "object" && raw !== null && Array.isArray((raw as { reports?: unknown }).reports)
      ? (raw as { reports: unknown[] }).reports
      : raw;

  if (Array.isArray(payload)) {
    for (const entry of payload as Array<RawReport & { mint?: string; address?: string }>) {
      const mint = entry.mint ?? entry.address;
      if (!mint) continue;
      const report = normalizeReport(mint, entry);
      if (report) out.set(mint, report);
    }
  } else if (typeof payload === "object" && payload !== null) {
    for (const [mint, value] of Object.entries(payload as Record<string, RawReport>)) {
      const report = normalizeReport(mint, value);
      if (report) out.set(mint, report);
    }
  }
  return out;
}

// A RugCheck-verified token from the verified list. jup* flags mirror Jupiter's
// own verification tiers; links are the token's declared official URLs.
export interface RugcheckVerifiedToken {
  mint: string;
  name: string;
  symbol: string;
  description: string;
  jupVerified: boolean;
  jupStrict: boolean;
  validated: boolean;
  links: Array<{ provider: string; value: string }>;
}

// A page of the verified token list. nextCursor is opaque — pass it back
// unchanged as the cursor argument to fetch the following page; null when the
// list is exhausted.
export interface RugcheckVerifiedPage {
  tokens: RugcheckVerifiedToken[];
  nextCursor: string | null;
}

interface RawVerifiedToken {
  mint?: string;
  name?: string;
  symbol?: string;
  description?: string;
  jup_verified?: boolean;
  jup_strict?: boolean;
  validated?: boolean;
  links?: Array<{ provider?: string; value?: string }>;
}

// The verified token list, paginated. Requires an API key. Returns an empty
// page (no tokens, null cursor) on any failure or missing key.
export async function getRugcheckVerifiedTokens(
  limit = 20,
  cursor?: string,
): Promise<RugcheckVerifiedPage> {
  const empty: RugcheckVerifiedPage = { tokens: [], nextCursor: null };

  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);

  const raw = (await fetchJson(`${BASE_URL}/tokens/verified?${params}`, {
    method: "GET",
    headers: { accept: "application/json" },
  })) as { tokens?: RawVerifiedToken[]; nextCursor?: string } | null;
  if (!raw || !Array.isArray(raw.tokens)) return empty;

  const tokens = raw.tokens.flatMap((t) =>
    t.mint
      ? [{
          mint: t.mint,
          name: t.name ?? "",
          symbol: t.symbol ?? "",
          description: t.description ?? "",
          jupVerified: t.jup_verified === true,
          jupStrict: t.jup_strict === true,
          validated: t.validated === true,
          links: Array.isArray(t.links)
            ? t.links.flatMap((l) =>
                l.provider && l.value
                  ? [{ provider: l.provider, value: l.value }]
                  : [],
              )
            : [],
        }]
      : [],
  );

  return { tokens, nextCursor: raw.nextCursor ?? null };
}

// The verification status of a single token — whether RugCheck has validated it
// and, if so, its declared official website/socials.
export interface RugcheckValidation {
  mint: string;
  validated: boolean;
  website: string | null;
  socials: Record<string, string>;
}

interface RawValidation {
  validated?: boolean;
  website?: string;
  socials?: Record<string, string>;
}

// Verification status for one token. This endpoint is public (no key required),
// so it degrades to a not-validated result only on network/parse failure.
export async function getRugcheckValidation(
  mint: string,
): Promise<RugcheckValidation> {
  const unvalidated: RugcheckValidation = {
    mint,
    validated: false,
    website: null,
    socials: {},
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/tokens/${mint}/validation`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return unvalidated;
    const raw = (await res.json()) as RawValidation | null;
    if (!raw || typeof raw !== "object") return unvalidated;
    return {
      mint,
      validated: raw.validated === true,
      website: typeof raw.website === "string" ? raw.website : null,
      socials:
        raw.socials && typeof raw.socials === "object" ? raw.socials : {},
    };
  } catch {
    return unvalidated;
  } finally {
    clearTimeout(timeout);
  }
}

// Whether a token is eligible for a RugCheck .token domain. Requires no key.
// Returns false on any failure — a conservative default (treat as ineligible).
export async function isRugcheckDomainEligible(mint: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/tokens/verify/eligible`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mint }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return false;
    const raw = (await res.json()) as { eligible?: boolean } | null;
    return raw?.eligible === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

// A recently-created token from the /stats/new_tokens feed. mintAuthority and
// freezeAuthority are the raw address strings ("" when revoked); we surface the
// revoked booleans since that is the gem-relevant signal. createdAt is ISO-8601.
export interface RugcheckNewToken {
  mint: string;
  symbol: string;
  creator: string;
  decimals: number;
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  createdAt: string;
}

interface RawNewToken {
  mint?: string;
  symbol?: string;
  creator?: string;
  decimals?: number;
  mintAuthority?: string;
  freezeAuthority?: string;
  createAt?: string;
}

// Generic GET for RugCheck's public /stats/* feeds. No key required; returns []
// on any failure so a stats outage never sinks a discovery flow.
async function fetchStatsArray<T>(path: string): Promise<T[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return [];
    const raw = await res.json();
    return Array.isArray(raw) ? (raw as T[]) : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

// Newly-created tokens (/stats/new_tokens) — the freshest launches, a primary
// discovery source for the gem pipeline. Returns [] on any failure.
export async function getRugcheckNewTokens(): Promise<RugcheckNewToken[]> {
  const raw = await fetchStatsArray<RawNewToken>("/stats/new_tokens");
  return raw.flatMap((t) =>
    t.mint
      ? [{
          mint: t.mint,
          symbol: t.symbol ?? "",
          creator: t.creator ?? "",
          decimals: typeof t.decimals === "number" ? t.decimals : 0,
          mintAuthorityRevoked: !t.mintAuthority,
          freezeAuthorityRevoked: !t.freezeAuthority,
          createdAt: t.createAt ?? "",
        }]
      : [],
  );
}

// A token from the /stats/recent (most-viewed) feed. visits/score are
// RugCheck's own popularity counters — attention signals, not risk signals.
export interface RugcheckViewedToken {
  mint: string;
  name: string;
  symbol: string;
  visits: number;
  score: number;
}

interface RawViewedToken {
  mint?: string;
  metadata?: { name?: string; symbol?: string };
  visits?: number;
  user_visits?: number;
  score?: number;
}

// Most-viewed tokens (/stats/recent) — what other RugCheck users are looking at
// right now. An attention/momentum signal for discovery. Returns [] on failure.
export async function getRugcheckViewedTokens(): Promise<RugcheckViewedToken[]> {
  const raw = await fetchStatsArray<RawViewedToken>("/stats/recent");
  return raw.flatMap((t) =>
    t.mint
      ? [{
          mint: t.mint,
          name: t.metadata?.name ?? "",
          symbol: t.metadata?.symbol ?? "",
          visits: typeof t.visits === "number" ? t.visits : 0,
          score: typeof t.score === "number" ? t.score : 0,
        }]
      : [],
  );
}

// A token from the /stats/trending feed, ranked by community vote. upCount is
// the upvote subset of voteCount — a rough sentiment ratio.
export interface RugcheckTrendingToken {
  mint: string;
  voteCount: number;
  upCount: number;
}

interface RawTrendingToken {
  mint?: string;
  vote_count?: number;
  up_count?: number;
}

// Trending tokens (/stats/trending) — ranked by community vote volume. A
// crowd-sentiment discovery source. Returns [] on any failure.
export async function getRugcheckTrendingTokens(): Promise<RugcheckTrendingToken[]> {
  const raw = await fetchStatsArray<RawTrendingToken>("/stats/trending");
  return raw.flatMap((t) =>
    t.mint
      ? [{
          mint: t.mint,
          voteCount: typeof t.vote_count === "number" ? t.vote_count : 0,
          upCount: typeof t.up_count === "number" ? t.up_count : 0,
        }]
      : [],
  );
}

// A recently-verified token from /stats/verified. Same shape as the paginated
// verified list, minus the validated flag (these are verified by definition).
export interface RugcheckRecentlyVerifiedToken {
  mint: string;
  name: string;
  symbol: string;
  description: string;
  jupVerified: boolean;
  jupStrict: boolean;
}

interface RawRecentlyVerifiedToken {
  mint?: string;
  name?: string;
  symbol?: string;
  description?: string;
  jup_verified?: boolean;
  jup_strict?: boolean;
}

// Recently-verified tokens (/stats/verified) — a curated feed of tokens that
// just cleared RugCheck verification. Returns [] on any failure.
export async function getRugcheckRecentlyVerified(): Promise<RugcheckRecentlyVerifiedToken[]> {
  const raw = await fetchStatsArray<RawRecentlyVerifiedToken>("/stats/verified");
  return raw.flatMap((t) =>
    t.mint
      ? [{
          mint: t.mint,
          name: t.name ?? "",
          symbol: t.symbol ?? "",
          description: t.description ?? "",
          jupVerified: t.jup_verified === true,
          jupStrict: t.jup_strict === true,
        }]
      : [],
  );
}

// A single locked-liquidity vault for a token. unlockDate is a unix timestamp
// (0 = locked indefinitely); usdcLocked is the vault's USD value. type names the
// locker program ("raydium_locker", ...). The strongest, longest lock is the
// gem-relevant signal — a large vault with unlockDate 0 is hard to rug.
export interface RugcheckLocker {
  account: string;
  programId: string;
  owner: string;
  uri: string;
  unlockDate: number;
  usdcLocked: number;
  type: string;
}

// Locked liquidity for a token: the individual vaults plus the total USD locked
// across them. totalUsdcLocked is what matters at a glance.
export interface RugcheckLockers {
  lockers: RugcheckLocker[];
  totalUsdcLocked: number;
}

interface RawLockers {
  lockers?: Record<
    string,
    {
      programID?: string;
      owner?: string;
      uri?: string;
      unlockDate?: number;
      usdcLocked?: number;
      type?: string;
    }
  >;
  total?: { totalUSDC?: number };
}

function normalizeLockers(raw: RawLockers | null): RugcheckLockers {
  const empty: RugcheckLockers = { lockers: [], totalUsdcLocked: 0 };
  if (!raw || typeof raw !== "object") return empty;

  // RugCheck keys lockers by vault account address; flatten to a list carrying
  // the account so callers don't have to walk the map.
  const lockers = raw.lockers
    ? Object.entries(raw.lockers).map(([account, l]) => ({
        account,
        programId: l.programID ?? "",
        owner: l.owner ?? "",
        uri: l.uri ?? "",
        unlockDate: typeof l.unlockDate === "number" ? l.unlockDate : 0,
        usdcLocked: typeof l.usdcLocked === "number" ? l.usdcLocked : 0,
        type: l.type ?? "unknown",
      }))
    : [];

  return {
    lockers,
    totalUsdcLocked:
      typeof raw.total?.totalUSDC === "number" ? raw.total.totalUSDC : 0,
  };
}

// Locked-liquidity vaults for a token (/tokens/{mint}/lockers). Requires a key.
// Locked LP is one of the strongest anti-rug signals — pair this with the
// report's lpLockedPct for a fuller picture. Returns an empty result on failure.
export async function getRugcheckLockers(mint: string): Promise<RugcheckLockers> {
  const raw = (await fetchJson(`${BASE_URL}/tokens/${mint}/lockers`, {
    method: "GET",
    headers: { accept: "application/json" },
  })) as RawLockers | null;
  return normalizeLockers(raw);
}

// FluxBeam-specific locked-liquidity vaults (/tokens/{mint}/lockers/flux). Same
// shape as getRugcheckLockers, scoped to the FluxBeam locker program. Requires a
// key. Returns an empty result on failure.
export async function getRugcheckFluxLockers(mint: string): Promise<RugcheckLockers> {
  const raw = (await fetchJson(`${BASE_URL}/tokens/${mint}/lockers/flux`, {
    method: "GET",
    headers: { accept: "application/json" },
  })) as RawLockers | null;
  return normalizeLockers(raw);
}

// Community vote tally for a token (/tokens/{mint}/votes). up/down are the raw
// counts; a lopsided ratio is a crowd-sentiment signal, not a risk verdict.
export interface RugcheckVotes {
  mint: string;
  up: number;
  down: number;
}

interface RawVotes {
  up?: number;
  down?: number;
  up_count?: number;
  down_count?: number;
}

// Read the community vote tally for a token. Public endpoint (no key). Returns
// zeroed counts on any failure.
export async function getRugcheckVotes(mint: string): Promise<RugcheckVotes> {
  const zeroed: RugcheckVotes = { mint, up: 0, down: 0 };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/tokens/${mint}/votes`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return zeroed;
    const raw = (await res.json()) as RawVotes | null;
    if (!raw || typeof raw !== "object") return zeroed;
    return {
      mint,
      up: raw.up ?? raw.up_count ?? 0,
      down: raw.down ?? raw.down_count ?? 0,
    };
  } catch {
    return zeroed;
  }
  finally {
    clearTimeout(timeout);
  }
}

// A page of RugCheck-verified .token domains. domain is the human-readable
// ".token" name mapped to the mint. nextPage is the 1-based page to request
// next, or null when exhausted.
export interface RugcheckDomain {
  domain: string;
  mint: string;
}

export interface RugcheckDomainPage {
  domains: RugcheckDomain[];
  nextPage: number | null;
}

interface RawDomain {
  domain?: string;
  name?: string;
  mint?: string;
  address?: string;
}

// Verified .token domains (/domains), paginated by 1-based page number.
// Public endpoint. Returns an empty page on any failure.
export async function getRugcheckDomains(
  page = 1,
  limit = 20,
): Promise<RugcheckDomainPage> {
  const empty: RugcheckDomainPage = { domains: [], nextPage: null };

  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    verified: "true",
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/domains?${params}`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return empty;
    const raw = await res.json();
    if (!Array.isArray(raw)) return empty;

    const domains = (raw as RawDomain[]).flatMap((d) => {
      const domain = d.domain ?? d.name;
      const mint = d.mint ?? d.address;
      return domain && mint ? [{ domain, mint }] : [];
    });

    // A full page implies there may be another; a short page ends the list.
    const nextPage = domains.length >= limit ? page + 1 : null;
    return { domains, nextPage };
  } catch {
    return empty;
  } finally {
    clearTimeout(timeout);
  }
}

// Resolve a single .token domain to its mint (/domains/lookup/{domain}).
// Public endpoint. Returns null when the domain is unknown or on any failure.
export async function lookupRugcheckDomain(domain: string): Promise<RugcheckDomain | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${BASE_URL}/domains/lookup/${encodeURIComponent(domain)}`,
      {
        headers: { accept: "application/json" },
        signal: controller.signal,
        cache: "no-store",
      },
    );
    if (!res.ok) return null;
    const raw = (await res.json()) as RawDomain | null;
    if (!raw || typeof raw !== "object") return null;
    const resolvedDomain = raw.domain ?? raw.name ?? domain;
    const mint = raw.mint ?? raw.address;
    return mint ? { domain: resolvedDomain, mint } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Bulk summary for up to N mints in one request. Returns a map keyed by mint;
// mints RugCheck couldn't score are simply absent from the map. Returns an
// empty map on total failure or missing key — callers treat absence as "unknown".
export async function getRugcheckSummaryBulk(
  mints: string[],
): Promise<Map<string, RugcheckSummary>> {
  const out = new Map<string, RugcheckSummary>();
  if (mints.length === 0) return out;

  const raw = await fetchJson(`${BASE_URL}/bulk/tokens/summary`, {
    method: "POST",
    body: JSON.stringify({ tokens: mints }),
  });
  if (!raw) return out;

  // The bulk endpoint may return either a map { mint: summary } or an array of
  // summaries carrying their own mint field. Handle both.
  if (Array.isArray(raw)) {
    for (const entry of raw as Array<RawSummary & { mint?: string; address?: string }>) {
      const mint = entry.mint ?? entry.address;
      if (!mint) continue;
      const summary = normalizeSummary(mint, entry);
      if (summary) out.set(mint, summary);
    }
  } else if (typeof raw === "object" && raw !== null) {
    for (const [mint, value] of Object.entries(raw as Record<string, RawSummary>)) {
      const summary = normalizeSummary(mint, value);
      if (summary) out.set(mint, summary);
    }
  }
  return out;
}
