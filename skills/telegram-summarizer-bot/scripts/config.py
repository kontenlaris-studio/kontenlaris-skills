"""Configuration for the summarizer bot — the ONLY module that reads
environment variables (declared in SKILL.md):
  BOT_TOKEN  Telegram bot token from BotFather (required)
  ADMIN_ID   Telegram user id allowed to call /stats (optional)
  DB_PATH    SQLite ledger path (optional, default ringkasbot.db)
"""
import os

BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
ADMIN_ID = int(os.environ.get("ADMIN_ID", "0") or 0)
DB_PATH = os.environ.get("DB_PATH", "ringkasbot.db")
