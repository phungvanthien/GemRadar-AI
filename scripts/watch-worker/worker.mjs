// Gem watchlist worker — re-scores up to 30 near-miss tokens every hour using
// deterministic tools only (RugCheck, Jupiter, DexScreener, on-chain). When a
// score trends up, the API escalates that mint to analyzeSolanaGems (not the
// chat agent). Requires the Next app running for POST /api/watchlist.
//
// Run:  npm run watch-worker
// Env:  WATCHLIST_RECHECK_URL (default http://localhost:3000/api/watchlist)
//       WATCHLIST_INTERVAL_MS (default 3600000 = 1h)
//       WATCHLIST_ONCE ("1" = single pass then exit)

const RECHECK_URL =
  process.env.WATCHLIST_RECHECK_URL || "http://localhost:3000/api/watchlist";
const INTERVAL_MS = Number(process.env.WATCHLIST_INTERVAL_MS || 3_600_000);
const ONCE = process.env.WATCHLIST_ONCE === "1";

function log(...args) {
  console.log(`[watch-worker ${new Date().toISOString()}]`, ...args);
}

async function tick() {
  try {
    const res = await fetch(RECHECK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      log("recheck failed:", json.error ?? res.status);
      return;
    }
    const s = json.summary ?? {};
    const suggested = s.aiRescoreSuggested ?? [];
    log(
      `checked=${s.checked ?? 0} dropped=${s.dropped ?? 0} escalated=${s.escalated ?? 0} ai=${s.aiAnalyzed ?? 0} rescore=[${suggested.map((x) => x.symbol).join(",")}] bought=[${(s.bought ?? []).join(",")}]`,
    );
    if (Array.isArray(s.errors) && s.errors.length > 0) {
      log("errors:", s.errors.join("; "));
    }
  } catch (e) {
    log("tick error:", e?.message ?? e);
  }
}

log(`recheck url=${RECHECK_URL} every ${INTERVAL_MS}ms`);
await tick();
if (ONCE) process.exit(0);

setInterval(tick, INTERVAL_MS);
