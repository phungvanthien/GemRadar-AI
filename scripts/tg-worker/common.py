"""Shared setup for the Telegram social worker: env loading + Telethon client.

Kept dependency-free apart from Telethon itself. The .env.local loader is a
minimal parser (no python-dotenv dependency) matching the format the Node side
already uses.
"""

from __future__ import annotations

import os
from pathlib import Path

from telethon.sync import TelegramClient

# scripts/tg-worker/ -> project root is two levels up.
ROOT = Path(__file__).resolve().parents[2]
ENV_PATH = ROOT / ".env.local"


def load_env() -> None:
    """Load KEY=VALUE lines from the project-root .env.local into os.environ.

    Does not overwrite variables already set in the environment. Silently does
    nothing if the file is absent (the caller validates required keys).
    """
    if not ENV_PATH.exists():
        return
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def _require(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        raise SystemExit(
            f"Missing {name}. Set it in {ENV_PATH} (see scripts/tg-worker/README.md)."
        )
    return val


def build_client() -> TelegramClient:
    """Construct a Telethon client from env, resolving the session path.

    The phone and 2FA password callables let start() source credentials from the
    environment; Telethon still prompts interactively for the one-time login code.
    """
    api_id = int(_require("TELEGRAM_API_ID"))
    api_hash = _require("TELEGRAM_API_HASH")
    phone = _require("TELEGRAM_PHONE")

    session = os.environ.get(
        "TELEGRAM_SESSION", str(Path(__file__).with_name("alphahunter.session"))
    )
    # Resolve a relative session path against the project root so it's stable
    # regardless of the working directory the worker is launched from.
    session_path = Path(session)
    if not session_path.is_absolute():
        session_path = ROOT / session_path

    client = TelegramClient(str(session_path), api_id, api_hash)

    # Wire phone + 2FA password from env for start(); Telethon prompts for the
    # login code itself.
    two_fa = os.environ.get("TELEGRAM_2FA_PASSWORD") or None
    client.session.phone = phone  # hint; start() still uses the callable below

    def phone_cb() -> str:
        return phone

    def password_cb() -> str:
        if not two_fa:
            # No 2FA configured but Telegram is asking — surface a clear message.
            raise SystemExit(
                "Account has 2FA enabled but TELEGRAM_2FA_PASSWORD is not set."
            )
        return two_fa

    # Stash the callables on the client for start() to use.
    client._alphahunter_phone_cb = phone_cb  # type: ignore[attr-defined]
    client._alphahunter_password_cb = password_cb  # type: ignore[attr-defined]
    return client


def start_client(client: TelegramClient) -> None:
    """Run the login flow using the env-sourced phone/password callables."""
    client.start(
        phone=client._alphahunter_phone_cb,  # type: ignore[attr-defined]
        password=client._alphahunter_password_cb,  # type: ignore[attr-defined]
    )
