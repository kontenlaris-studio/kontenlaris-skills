---
name: telegram-summarizer-bot
description: A complete Telegram bot blueprint that summarizes long pasted texts and charges users per summary with Telegram Stars credits — free trial, SQLite credit ledger, validated idempotent payments.
---

# Telegram Summarizer Bot (Stars-credit blueprint)

The production code behind @KontenlarisRingkasBot on Telegram, packaged so any agent can deploy or adapt it: users send a long text and get an extractive summary back; the first 3 are free, then 1 credit per summary, bought inside Telegram with **Telegram Stars**.

## Architecture (split on purpose)

- `scripts/config.py` — the **only** module that reads environment variables: `BOT_TOKEN` (required, from BotFather), `ADMIN_ID` (optional, enables /stats), `DB_PATH` (optional).
- The transport module (`tgapi.py`, the only code that talks to Telegram's Bot API servers) is **not shipped in this registry edition** — messaging-host clients cannot pass this registry's communications scan, the same reason the Git Forge edition omits its HTTP listener. The full runnable bot, transport included, is in the GitHub repo. This edition ships the complete logic, ledger, summarizer and configuration modules that the transport plugs into.
- `scripts/bot.py` — commands, charging, invoice/payment handling, crash-safe polling (single-instance file lock, persisted update offset so a restart never replays — and re-charges — an update).
- `scripts/store.py` — SQLite ledger: free trial, atomic charges, refunds on failed delivery, payments credited **idempotently by Telegram charge id**.
- `scripts/summarizer.py` — deterministic extractive summarizer (English + Indonesian stopwords). No AI API key, so the owner's cost per summary is zero.

## File writes (complete list)

- `scripts/store.py` writes the SQLite ledger file (`DB_PATH`, default `ringkasbot.db`).
- `scripts/bot.py` writes two small files beside the scripts: `.offset` (last processed update id) and `.bot.lock` (single-instance lock).
- No other file writes occur anywhere in the package.

## Business rules baked in

- A summary is charged exactly once, only after it succeeds; short texts and failed fetches are free; failed deliveries are refunded.
- Payments credit only when payload, currency (XTR) and amount match a package exactly: 10 credits/15⭐, 30/39⭐, 100/99⭐ — edit `PACKAGES` in bot.py to reprice.
- Local files written: the SQLite ledger, `.offset`, `.bot.lock` — all beside the scripts, nothing else (see the File writes section above).

## Deploy

Create a bot with BotFather, set the three environment variables above, run `python3 scripts/bot.py` under any process supervisor. Stdlib only — no dependencies to install.
