#!/usr/bin/env python3
"""One-time interactive login for the Telegram social worker.

Reads TELEGRAM_* from the project-root .env.local, connects with Telethon, and
prompts for the OTP Telegram sends to your app (and the 2FA password if set).
This creates the session file so worker.py can run non-interactively afterwards.

Run once:  python login.py
"""

import sys

from common import build_client, load_env, start_client


def main() -> int:
    load_env()
    client = build_client()

    # start() performs the interactive login: it sources the phone and 2FA
    # password from the environment via our callables, and prompts interactively
    # for the one-time login code Telegram sends to your app.
    start_client(client)

    me = client.get_me()
    handle = f"@{me.username}" if me.username else f"id {me.id}"
    print(f"Logged in as {handle}. Session saved.")
    client.disconnect()
    return 0


if __name__ == "__main__":
    sys.exit(main())
