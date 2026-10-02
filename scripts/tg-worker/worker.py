#!/usr/bin/env python3
"""AlphaHunter social worker — Telegram + X (Twitter) combined.

Reads watchlist.json (written by the Next.js gem scan) and for every active
gem does TWO things:

  1. TELEGRAM  — joins the project's Telegram channel (read-only, rate-limited)
     and measures: member count, msg/hour, group age.
     Writes  → ../social-scores.json   { [mint]: { socialScore, ... } }

  2. X / TWITTER — searches $SYMBOL via Nitter public RSS (no account, no API
     key, no Playwright, no ban risk) and measures: tweet count, unique authors,
     avg engagement (likes+retweets), freshness (< 24 h).
     Writes  → ../x-scores.json        { [mint]: { xScore, ... } }

Both scores feed into gem-score.ts → Social category (10 % weight).
src/lib/social-store.ts merges them; a gem that has only one of the two is
still "covered" for Social scoring.

Safety rules (same as before):
  - Uses a REAL Telegram user account via MTProto (Telethon).
  - Telegram can ban accounts that auto-join/leave in bulk → use a secondary
    phone number. See scripts/tg-worker/README.md.
  - Nitter RSS is public / anonymous → no account risk for X.
  - If all Nitter instances are down the X score is skipped gracefully.

Run:
  python worker.py          # one pass over the watchlist
  python worker.py --watch  # re-run every <x.pollIntervalMinutes> minutes
"""

from __future__ import annotations

import argparse
import json
import random
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Optional
from urllib.request import urlopen, Request
from urllib.error import URLError

from telethon.errors import (
    ChannelPrivateError,
    FloodWaitError,
    InviteHashExpiredError,
    UsernameNotOccupiedError,
)
from telethon.tl.functions.channels import GetFullChannelRequest, LeaveChannelRequest
from telethon.tl.functions.messages import ImportChatInviteRequest

from common import ROOT, build_client, load_env, start_client

# ── File paths ────────────────────────────────────────────────────────────────
WATCHLIST       = Path(__file__).with_name("watchlist.json")
SOCIAL_SCORES   = ROOT / "scripts" / "social-scores.json"  # Telegram scores
X_SCORES        = ROOT / "scripts" / "x-scores.json"       # X / Twitter scores
CONFIG_PATH     = ROOT / "social-monitor.config.json"

# ── Nitter public instances ───────────────────────────────────────────────────
# Tried in order; first one that returns HTTP 200 is used.
# Up-to-date list: https://status.d420.de/  (filter by RSS ✓)
NITTER_INSTANCES = [
    "https://nitter.privacyredirect.com",
    "https://nitter.poast.org",
    "https://nitter.woodland.cafe",
    "https://lightbrd.com",
    "https://nitter.net",
]

# ── Scoring constants ─────────────────────────────────────────────────────────
# Telegram  — unchanged from the original worker
TG_MEMBERS_SAT   = 2_000   # members at which member-score saturates
TG_MSG_HR_SAT    = 30.0    # msg/hour saturation
TG_AGE_SAT_DAYS  = 7.0     # group-age saturation (days)

# X — tweet buzz scoring (same model as twitter_scraper.ts for consistency)
X_TWEET_SAT      = 40      # tweet-count saturation
X_AUTHORS_SAT    = 25      # unique-author saturation
X_ENG_SAT        = 50.0    # avg engagement saturation (likes+retweets)
X_PUPPET_RATIO   = 0.30    # uniqueAuthors/tweetCount below this → cap at 50
X_PUPPET_CAP     = 50.0
X_RECENT_H       = 24      # tweets younger than this count as "recent"
X_MAX_ITEMS      = 60      # max RSS items to collect across paginated fetch

# HTTP timeout for Nitter requests (seconds)
HTTP_TIMEOUT     = 12


# ═════════════════════════════════════════════════════════════════════════════
# Config
# ═════════════════════════════════════════════════════════════════════════════

def _load_config() -> dict:
    """Read social-monitor.config.json. Returns merged dict with safe defaults."""
    defaults = {
        "telegram": {
            "enabled": True,
            "maxJoinsPerRun": 3,
            "minJoinDelaySeconds": 45,
            "maxJoinDelaySeconds": 120,
            "historySampleSize": 100,
            "leaveOnStatus": ["fail", "sold"],
            "leaveAfterHoursIfBelowScore": 48,
            "leaveScoreFloor": 30,
        },
        "x": {
            "enabled": True,
            "source": "nitter",        # "nitter" | "none"
            "maxAccountsPerRun": 10,
            "pollIntervalMinutes": 60,
        },
    }
    try:
        raw = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        for section in ("telegram", "x"):
            if isinstance(raw.get(section), dict):
                defaults[section].update(raw[section])
    except (FileNotFoundError, json.JSONDecodeError, TypeError):
        pass
    return defaults


_CFG = _load_config()

# Telegram knobs
TG_ENABLED       = _CFG["telegram"].get("enabled", True)
MAX_JOINS        = int(_CFG["telegram"].get("maxJoinsPerRun", 3))
MIN_DELAY_S      = float(_CFG["telegram"].get("minJoinDelaySeconds", 45))
MAX_DELAY_S      = float(_CFG["telegram"].get("maxJoinDelaySeconds", 120))
HISTORY_SAMPLE   = int(_CFG["telegram"].get("historySampleSize", 100))
LEAVE_ON_STATUS  = tuple(_CFG["telegram"].get("leaveOnStatus", ["fail", "sold"]))
LEAVE_AFTER_H    = float(_CFG["telegram"].get("leaveAfterHoursIfBelowScore", 48))
LEAVE_SCORE_FLOOR = float(_CFG["telegram"].get("leaveScoreFloor", 30))

# X knobs
X_ENABLED        = (
    _CFG["x"].get("enabled", True)
    and _CFG["x"].get("source", "nitter") == "nitter"
)
X_MAX_PER_RUN    = int(_CFG["x"].get("maxAccountsPerRun", 10))
POLL_INTERVAL_M  = int(_CFG["x"].get("pollIntervalMinutes", 60))


# ═════════════════════════════════════════════════════════════════════════════
# Helpers
# ═════════════════════════════════════════════════════════════════════════════

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def write_json(path: Path, data) -> None:
    """Atomic write via temp-file + replace, same as tg-worker convention."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    tmp.replace(path)


# ─── Telegram link parser (unchanged from original worker) ───────────────────

_PUBLIC_RE = re.compile(r"(?:https?://)?t\.me/(?!\+|joinchat/)([A-Za-z0-9_]{4,32})/?")
_INVITE_RE = re.compile(r"(?:https?://)?t\.me/(?:\+|joinchat/)([A-Za-z0-9_-]+)/?")
_AT_RE     = re.compile(r"^@([A-Za-z0-9_]{4,32})$")


def parse_telegram_link(link: str):
    link = link.strip()
    m = _AT_RE.match(link)
    if m:
        return ("public", m.group(1))
    m = _INVITE_RE.match(link)
    if m:
        return ("invite", m.group(1))
    m = _PUBLIC_RE.match(link)
    if m:
        return ("public", m.group(1))
    return None


# ═════════════════════════════════════════════════════════════════════════════
# Telegram scoring  (exactly the original logic)
# ═════════════════════════════════════════════════════════════════════════════

def measure_channel(client, entity) -> dict:
    """Read-only metadata: member count, msg/hour, group age (days)."""
    members = None
    try:
        full = client(GetFullChannelRequest(entity))
        members = getattr(full.full_chat, "participants_count", None)
    except Exception:
        members = None

    msg_per_hour = None
    try:
        msgs = list(client.iter_messages(entity, limit=HISTORY_SAMPLE))
        stamped = [m.date for m in msgs if m.date is not None]
        if len(stamped) >= 2:
            newest, oldest = stamped[0], stamped[-1]
            span_hours = max((newest - oldest).total_seconds() / 3600.0, 1e-6)
            msg_per_hour = len(stamped) / span_hours
    except Exception:
        msg_per_hour = None

    group_age_days = None
    created = getattr(entity, "date", None)
    if created is not None:
        group_age_days = max(
            0.0, (datetime.now(timezone.utc) - created).total_seconds() / 86400.0
        )

    return {
        "members":      members,
        "msgPerHour":   round(msg_per_hour, 2)    if msg_per_hour    is not None else None,
        "groupAgeDays": round(group_age_days, 1)  if group_age_days  is not None else None,
    }


def telegram_social_score(metrics: dict) -> float:
    """0-100 from quantitative Telegram signals (unchanged formula)."""
    score = 0.0

    members = metrics.get("members")
    if isinstance(members, (int, float)) and members > 0:
        score += min(members / TG_MEMBERS_SAT, 1.0) * 50

    mph = metrics.get("msgPerHour")
    if isinstance(mph, (int, float)) and mph > 0:
        score += min(mph / TG_MSG_HR_SAT, 1.0) * 35

    age = metrics.get("groupAgeDays")
    if isinstance(age, (int, float)) and age > 0:
        score += min(age / TG_AGE_SAT_DAYS, 1.0) * 15

    return round(min(score, 100.0), 1)


def slow_delay() -> None:
    delay = MIN_DELAY_S + random.random() * (MAX_DELAY_S - MIN_DELAY_S)
    print(f"  … waiting {delay:.0f}s (Telegram rate-limit safety)")
    time.sleep(delay)


# ═════════════════════════════════════════════════════════════════════════════
# X / Twitter scoring  (Nitter RSS — no account, no Playwright)
# ═════════════════════════════════════════════════════════════════════════════

def _http_get(url: str) -> Optional[bytes]:
    """Minimal HTTP GET with a browser-like User-Agent. Returns None on error."""
    req = Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) "
                "Gecko/20100101 Firefox/120.0"
            ),
            "Accept": "application/rss+xml, application/xml, text/xml, */*",
        },
    )
    try:
        with urlopen(req, timeout=HTTP_TIMEOUT) as resp:
            if resp.status == 200:
                return resp.read()
    except (URLError, OSError):
        pass
    return None


def _pick_nitter() -> Optional[str]:
    """Return the first Nitter instance that responds, or None if all are down."""
    for base in NITTER_INSTANCES:
        probe = f"{base}/search/rss?q=%24TEST&f=tweets"
        data = _http_get(probe)
        if data is not None:
            return base
    return None


def _parse_rss_items(xml_bytes: bytes) -> list[dict]:
    """
    Parse a Nitter RSS feed and return a list of items.
    Each item: { author, pubdate (datetime | None), description }
    """
    items = []
    try:
        root = ET.fromstring(xml_bytes)
        ns = {"dc": "http://purl.org/dc/elements/1.1/"}
        for item in root.iter("item"):
            creator = item.findtext("dc:creator", namespaces=ns) or ""
            author  = creator.strip().lstrip("@") or "unknown"

            pub_raw = item.findtext("pubDate") or ""
            pub_dt  = None
            if pub_raw:
                try:
                    pub_dt = parsedate_to_datetime(pub_raw)
                except Exception:
                    pass

            desc = item.findtext("description") or ""
            items.append({"author": author, "pubdate": pub_dt, "description": desc})
    except ET.ParseError:
        pass
    return items


def _count_engagement(description: str) -> int:
    """
    Nitter RSS puts engagement counts inside the <description> HTML like:
      ♻ 12  ❤ 345
    Extract and sum them.  Returns 0 when nothing is parseable.
    """
    total = 0
    for m in re.finditer(r"(?:♻|❤|💬|🔁|👍)\s*([\d,]+)", description):
        try:
            total += int(m.group(1).replace(",", ""))
        except ValueError:
            pass
    # Fallback: plain digit runs after common engagement glyphs.
    if total == 0:
        for m in re.finditer(
            r"(?:retweet|like|reply|quote)[s]?\D{0,6}([\d,]+)",
            description,
            re.IGNORECASE,
        ):
            try:
                total += int(m.group(1).replace(",", ""))
            except ValueError:
                pass
    return total


def scrape_x_buzz(symbol: str, nitter_base: str) -> dict:
    """
    Fetch Nitter RSS for $SYMBOL, compute buzz stats.

    Returns dict matching XScoreEntry (without 'symbol').
    """
    query    = f"${symbol}"
    base_out = {
        "xScore":       0,
        "tweetCount":   0,
        "uniqueAuthors": 0,
        "avgEngagement": 0.0,
        "recentTweets": 0,
        "searchQuery":  query,
        "scrapedAt":    _now_iso(),
        "source":       "nitter",
        "error":        None,
    }

    # Nitter search RSS: ?q=$SYMBOL&f=tweets  (latest-first)
    # Some instances also support ?since_id= pagination but we keep it simple.
    encoded = query.replace("$", "%24").replace(" ", "+")
    url     = f"{nitter_base}/search/rss?q={encoded}&f=tweets"

    raw = _http_get(url)
    if raw is None:
        base_out["error"] = f"Nitter fetch failed ({nitter_base})"
        return base_out

    items = _parse_rss_items(raw)
    if not items:
        # Empty feed = no tweets (valid result, not an error).
        return base_out

    # Limit to X_MAX_ITEMS so one huge token can't skew the run.
    items = items[:X_MAX_ITEMS]

    now_utc   = datetime.now(timezone.utc)
    cutoff    = now_utc.timestamp() - X_RECENT_H * 3600

    authors      = set()
    recent       = 0
    eng_total    = 0
    valid_items  = 0

    for it in items:
        author = it["author"]
        if author and author != "unknown":
            authors.add(author)

        if it["pubdate"] is not None:
            try:
                ts = it["pubdate"].timestamp()
                if ts >= cutoff:
                    recent += 1
            except Exception:
                pass

        eng = _count_engagement(it["description"])
        eng_total   += eng
        valid_items += 1

    tweet_count    = valid_items
    unique_authors = len(authors)
    avg_eng        = round(eng_total / tweet_count, 1) if tweet_count > 0 else 0.0

    x_score = _compute_x_score(tweet_count, unique_authors, avg_eng, recent)

    return {
        **base_out,
        "xScore":        x_score,
        "tweetCount":    tweet_count,
        "uniqueAuthors": unique_authors,
        "avgEngagement": avg_eng,
        "recentTweets":  recent,
        "scrapedAt":     _now_iso(),
    }


def _compute_x_score(
    tweet_count:    int,
    unique_authors: int,
    avg_engagement: float,
    recent_tweets:  int,
) -> float:
    """
    0-100 buzz score — mirrors the TypeScript computeXScore() in twitter_scraper.ts
    so both paths are consistent.

      Tweet volume      35 pts  (saturates at X_TWEET_SAT)
      Unique authors    25 pts  (saturates at X_AUTHORS_SAT)
      Avg engagement    25 pts  (saturates at X_ENG_SAT)
      Freshness         15 pts  (fraction of tweets within last 24h)

    Cap at 50 when unique_authors / tweet_count < X_PUPPET_RATIO
    (sock-puppet smell: many tweets, very few distinct authors).
    """
    score = 0.0

    if tweet_count > 0:
        score += min(tweet_count / X_TWEET_SAT, 1.0) * 35

    if unique_authors > 0:
        score += min(unique_authors / X_AUTHORS_SAT, 1.0) * 25

    if avg_engagement > 0:
        score += min(avg_engagement / X_ENG_SAT, 1.0) * 25

    if tweet_count > 0:
        score += min(recent_tweets / tweet_count, 1.0) * 15

    # Sock-puppet cap
    if tweet_count >= 10 and unique_authors / tweet_count < X_PUPPET_RATIO:
        score = min(score, X_PUPPET_CAP)

    return round(min(max(score, 0.0), 100.0), 1)


# ═════════════════════════════════════════════════════════════════════════════
# Main pass
# ═════════════════════════════════════════════════════════════════════════════

def main(single_pass: bool = True) -> int:
    load_env()

    watchlist    = read_json(WATCHLIST, {})
    tg_scores    = read_json(SOCIAL_SCORES, {})
    x_scores_all = read_json(X_SCORES, {})

    if not isinstance(watchlist, dict) or not watchlist:
        print("watchlist.json is empty — nothing to do. Run a gem scan first.")
        return 0

    # ── Probe Nitter once per run ──────────────────────────────────────────
    nitter_base: Optional[str] = None
    if X_ENABLED:
        print("Probing Nitter instances …", end=" ", flush=True)
        nitter_base = _pick_nitter()
        if nitter_base:
            print(f"using {nitter_base}")
        else:
            print("all instances unreachable — X scoring skipped this run")

    # ── Connect Telegram (only when TG scoring is enabled) ────────────────
    client = None
    if TG_ENABLED:
        client = build_client()
        start_client(client)

    joins_this_run = 0
    x_count_this_run = 0

    try:
        for mint, info in watchlist.items():
            if not isinstance(info, dict):
                continue

            symbol = info.get("symbol", "")
            status = info.get("status", "active")
            telegram_link = info.get("telegram")
            existing_tg = tg_scores.get(mint, {}) if isinstance(tg_scores, dict) else {}

            # ── TELEGRAM leave flow ───────────────────────────────────────
            if client and status in LEAVE_ON_STATUS:
                if existing_tg.get("joinedAt") and not existing_tg.get("leftAt"):
                    parsed = parse_telegram_link(telegram_link or "")
                    if parsed and parsed[0] == "public":
                        try:
                            entity = client.get_entity(parsed[1])
                            client(LeaveChannelRequest(entity))
                            existing_tg["leftAt"]     = _now_iso()
                            existing_tg["leftReason"] = status
                            tg_scores[mint]           = existing_tg
                            write_json(SOCIAL_SCORES, tg_scores)
                            print(f"Left {telegram_link} ({mint[:6]}…) — status={status}")
                        except Exception as e:
                            print(f"  could not leave {telegram_link}: {e}")
                # Fall through so X still runs on leave-status tokens
                # (we still want fresh buzz data even if we've left TG).

            # ── TELEGRAM join + measure ───────────────────────────────────
            tg_scored_now = False
            if (
                client
                and status not in LEAVE_ON_STATUS
                and not (
                    # Already scored and still active → skip re-join
                    mint in tg_scores
                    and tg_scores[mint].get("joinedAt")
                    and not tg_scores[mint].get("leftAt")
                )
                and telegram_link
            ):
                parsed = parse_telegram_link(telegram_link)
                if not parsed:
                    print(f"  skip TG {mint[:6]}… — bad link: {telegram_link}")
                elif joins_this_run >= MAX_JOINS:
                    print(f"MAX_JOINS_PER_RUN ({MAX_JOINS}) reached; skipping TG for {symbol}")
                else:
                    try:
                        kind, ident = parsed
                        if kind == "invite":
                            try:
                                client(ImportChatInviteRequest(ident))
                            except InviteHashExpiredError:
                                print(f"  skip TG {mint[:6]}… — invite expired")
                                parsed = None  # signal skip
                            if parsed:
                                entity = client.get_entity(telegram_link)
                        else:
                            entity = client.get_entity(ident)
                            from telethon.tl.functions.channels import JoinChannelRequest
                            client(JoinChannelRequest(entity))

                        if parsed:
                            joins_this_run += 1
                            metrics = measure_channel(client, entity)
                            entry = {
                                **metrics,
                                "socialScore": telegram_social_score(metrics),
                                "telegram":    telegram_link,
                                "joinedAt":    _now_iso(),
                            }
                            tg_scores[mint] = entry
                            write_json(SOCIAL_SCORES, tg_scores)
                            print(
                                f"  [TG] {symbol} ({mint[:6]}…): "
                                f"socialScore={entry['socialScore']}  "
                                f"members={metrics['members']}  "
                                f"msg/h={metrics['msgPerHour']}"
                            )
                            tg_scored_now = True

                            if joins_this_run < MAX_JOINS:
                                slow_delay()

                    except FloodWaitError as e:
                        print(f"  FloodWait {e.seconds}s — stopping TG joins this run")
                        MAX_JOINS_REACHED = True  # noqa: F841 — flag; we keep going with X
                    except (UsernameNotOccupiedError, ChannelPrivateError) as e:
                        print(f"  skip TG {mint[:6]}… — {type(e).__name__}")
                    except Exception as e:
                        print(f"  TG error {telegram_link}: {e}")

            # ── X / Twitter buzz ──────────────────────────────────────────
            if (
                X_ENABLED
                and nitter_base
                and symbol
                and status == "active"
                and x_count_this_run < X_MAX_PER_RUN
            ):
                print(f"  [X]  {symbol} ({mint[:6]}…): scraping ${symbol} …", end=" ", flush=True)
                x_entry = scrape_x_buzz(symbol, nitter_base)
                x_entry["symbol"] = symbol
                x_scores_all[mint] = x_entry
                write_json(X_SCORES, x_scores_all)
                x_count_this_run += 1

                if x_entry.get("error"):
                    print(f"error: {x_entry['error']}")
                else:
                    print(
                        f"xScore={x_entry['xScore']}  "
                        f"tweets={x_entry['tweetCount']}  "
                        f"authors={x_entry['uniqueAuthors']}  "
                        f"avgEng={x_entry['avgEngagement']}  "
                        f"recent={x_entry['recentTweets']}"
                    )

    finally:
        if client:
            client.disconnect()

    print(
        f"\nDone — TG joins: {joins_this_run}/{MAX_JOINS}  "
        f"X scored: {x_count_this_run}/{X_MAX_PER_RUN}"
    )
    return 0


# ═════════════════════════════════════════════════════════════════════════════
# Entry point
# ═════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="AlphaHunter social worker — Telegram + X (Nitter)"
    )
    parser.add_argument(
        "--watch",
        action="store_true",
        help=f"Re-run every {POLL_INTERVAL_M} min instead of a single pass",
    )
    args = parser.parse_args()

    if not args.watch:
        raise SystemExit(main())

    # ── Watch mode ────────────────────────────────────────────────────────
    print(
        f"Watch mode: running every {POLL_INTERVAL_M} min. "
        "Press Ctrl+C to stop.\n"
    )
    while True:
        try:
            main()
        except Exception as exc:
            print(f"[worker] run error: {exc}")
        print(f"\nSleeping {POLL_INTERVAL_M} min …")
        time.sleep(POLL_INTERVAL_M * 60)
