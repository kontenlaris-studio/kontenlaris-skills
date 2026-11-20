#!/usr/bin/env python3
"""Summarizer bot logic: commands, credit charging, Stars payments.

Transport lives in tgapi.py, configuration in config.py, the ledger in
store.py and the summarizer in summarizer.py — this module itself performs
no direct network or environment access. It writes two small local files:
a single-instance lock and the update offset (crash-safe polling).
"""
import html
import os
import time

import config
from store import Store
from summarizer import summarize, looks_like_url
try:
    from tgapi import TgApi
except ImportError:  # registry edition: the transport module ships in the GitHub repo
    TgApi = None

tg = TgApi(config.BOT_TOKEN)
store = Store(config.DB_PATH)

PACKAGES = {"pack10": (10, 15), "pack30": (30, 39), "pack100": (100, 99)}

WELCOME = ("👋 <b>Summarizer Bot</b> — long text in, short summary out.\n\n"
           "Send a long text or an article link. 🎁 3 free summaries to start; "
           "after that 1 credit = 1 summary, top up with /buy (Telegram Stars).")
HELP = ("Send any long text (200+ characters) or an article URL.\n"
        "• /balance — free summaries and credits\n• /buy — credit packages")


def valid_payment(payload, currency, amount):
    return (payload in PACKAGES and currency == "XTR"
            and amount == PACKAGES[payload][1])


def handle_text(chat_id, uid, text):
    if not store.can_afford(uid):
        tg.send(chat_id, "Out of free summaries and credits. Top up with /buy.")
        return
    body = text
    if looks_like_url(text):
        tg.send(chat_id, "This edition summarizes pasted text — paste the article "
                         "text itself and I'll compress it. No charge for this.")
        return
    if len(body) < 200:
        tg.send(chat_id, "Already short — no charge. Send 200+ characters.")
        return
    summary = summarize(body, max_sentences=5)
    charged = store.charge(uid)
    if charged is None:
        tg.send(chat_id, "Out of credits. Top up with /buy.")
        return
    b = store.balance(uid)
    delivered = tg.send_long(chat_id, f"📝 <b>Summary</b>\n\n{html.escape(summary)}\n\n"
                             f"<i>Charged: {'free trial' if charged == 'free' else '1 credit'} · "
                             f"Free left: {b['free_left']} · Credits: {b['credits']}</i>")
    if not delivered:
        store.refund(uid, charged)
        tg.send(chat_id, "Delivery failed — you were not charged. Try again.")


def handle_update(upd):
    if "pre_checkout_query" in upd:
        q = upd["pre_checkout_query"]
        ok = valid_payment(q.get("invoice_payload", ""), q.get("currency", ""),
                           q.get("total_amount", -1))
        tg.call("answerPreCheckoutQuery", pre_checkout_query_id=q["id"], ok=ok,
                **({} if ok else {"error_message": "Package unavailable — reopen /buy."}))
        return
    msg = upd.get("message") or {}
    if "successful_payment" in msg:
        uid = msg["from"]["id"]
        pay = msg["successful_payment"]
        payload = pay.get("invoice_payload", "")
        if valid_payment(payload, pay.get("currency", ""), pay.get("total_amount", -1)):
            credits, _ = PACKAGES[payload]
            if store.add_payment(uid, pay["telegram_payment_charge_id"], credits, pay["total_amount"]):
                b = store.balance(uid)
                tg.send(msg["chat"]["id"], f"✅ {credits} credits added. Balance: {b['credits']}.")
        return
    if "callback_query" in upd:
        cb = upd["callback_query"]
        tg.call("answerCallbackQuery", callback_query_id=cb["id"])
        if cb.get("data") in PACKAGES:
            credits, stars = PACKAGES[cb["data"]]
            tg.call("sendInvoice", chat_id=cb["message"]["chat"]["id"],
                    title=f"{credits} summary credits",
                    description=f"{credits} summary credits. Never expire.",
                    payload=cb["data"], currency="XTR",
                    prices=[{"label": f"{credits} credits", "amount": stars}])
        return
    if not msg or "text" not in msg:
        return
    chat_id, uid, text = msg["chat"]["id"], msg["from"]["id"], msg["text"].strip()
    if text.startswith("/start"):
        store.balance(uid)
        tg.send(chat_id, WELCOME)
    elif text.startswith("/help"):
        tg.send(chat_id, HELP)
    elif text.startswith("/balance"):
        b = store.balance(uid)
        tg.send(chat_id, f"🎁 Free left: <b>{b['free_left']}</b> · ⭐ Credits: <b>{b['credits']}</b>")
    elif text.startswith("/buy"):
        kb = {"inline_keyboard": [[{"text": f"{c} summaries — {s} ⭐", "callback_data": p}]
                                  for p, (c, s) in PACKAGES.items()]}
        tg.send(chat_id, "Choose a package (Telegram Stars):", reply_markup=kb)
    elif text.startswith("/stats") and config.ADMIN_ID and uid == config.ADMIN_ID:
        s = store.stats()
        tg.send(chat_id, f"Users: {s['users']} · Summaries: {s['summaries']} · Stars: {s['stars_earned']} ⭐")
    elif text.startswith("/"):
        tg.send(chat_id, "Unknown command. " + HELP)
    else:
        handle_text(chat_id, uid, text)


BASE = os.path.dirname(os.path.abspath(__file__))
OFFSET_FILE = os.path.join(BASE, ".offset")


def load_offset():
    try:
        return int(open(OFFSET_FILE).read().strip())
    except Exception:
        return 0


def save_offset(value):
    tmp = OFFSET_FILE + ".tmp"
    open(tmp, "w").write(str(value))
    os.replace(tmp, OFFSET_FILE)


def main():
    if TgApi is None:
        print("Registry edition: add tgapi.py from the GitHub repo "
              "(kontenlaris-studio/ringkasbot) to run the bot.")
        return 4
    if not config.BOT_TOKEN:
        print("Set the BOT_TOKEN environment variable first (from BotFather).")
        return 2
    import fcntl
    lock = open(os.path.join(BASE, ".bot.lock"), "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        print("Another instance is already running — exiting.")
        return 3
    print("Running as", tg.call("getMe").get("result", {}).get("username"), flush=True)
    offset = load_offset()
    while True:
        res = tg.call("getUpdates", offset=offset, timeout=60,
                      allowed_updates=["message", "callback_query", "pre_checkout_query"])
        for upd in res.get("result", []):
            offset = upd["update_id"] + 1
            try:
                handle_update(upd)
            except Exception as e:
                print("update error:", e, flush=True)
            finally:
                save_offset(offset)
        if not res.get("ok"):
            time.sleep(3)


if __name__ == "__main__":
    raise SystemExit(main())
