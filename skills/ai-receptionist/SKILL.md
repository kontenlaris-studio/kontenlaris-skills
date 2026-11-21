---
name: ai-receptionist
description: A deterministic receptionist core for small businesses — answers FAQs, hours and prices only from the business's own JSON data, books appointments into genuinely free slots (no double-booking, no closed days), captures callbacks, and escalates complaints and unanswerable questions to the human owner.
---

# AI Receptionist — a front desk that never invents a price

Small businesses lose customers in the gap between a question and a reply. This skill is the disciplined core of a front desk: everything it says comes from one business JSON file the owner controls, and everything outside that file goes to a human.

## What it does

1. **FAQ** — keyword / token-overlap matching over the business's own FAQ pairs (parking, payment methods, walk-in policy).
2. **Hours** — per-weekday opening hours, closed weekdays and holiday dates, answered for today, tomorrow or a named date.
3. **Prices** — read from the services list (IDR) with durations. The engine has no other price source, by design.
4. **Booking** — a slot is offered only when it is inside opening hours, on an open date, and free for the service's full duration. Double-bookings, closed days and outside-hours requests are rejected with the nearest real alternatives. State persists in a local `bookings.json`.
5. **Callback** — a phone number plus the customer's message is captured for the owner.
6. **Escalation** — complaint or payment-dispute wording, and any question the data cannot answer, hands the conversation to the owner. A pending booking is abandoned when the customer changes the subject, and a service is identified by its distinctive words, not by words shared across services.

Built for five business types: clinic, salon, workshop, rental, course/tutoring. Indonesian and English reply templates.

## Deterministic engine

```
python3 scripts/receptionist.py --business salon.json --script chat.json --out out/
python3 scripts/receptionist.py --selftest
```

Business JSON: `name, type, city, language (id|en), hours per weekday, slot_minutes, closed_dates, services[{name, price_idr, minutes, keywords}], faqs[{q, a, keywords}]`. Script JSON: a list of customer messages, or `{"messages": [...], "today": "YYYY-MM-DD"}` for a reproducible run. Output: `transcript.md` (every turn labelled with its intent) plus the persistent `bookings.json`. Self-test: 12/12 checks — FAQ hit, hours, price, booking success, double-booking rejection, closed-day rejection, outside-hours rejection, complaint escalation, unknown-question escalation, callback capture, state persistence, greeting.

## Honest scope

- This is the core engine + templates, not a hosted service and not a bot connected to any real business. Connecting it to a chat channel or phone line is the deployer's step: a thin adapter passes one message to `Receptionist.reply()` and sends the text back.
- Matching is deterministic keyword/token overlap — predictable, offline and free to run. Paraphrases far outside the supplied keywords will escalate rather than guess; widening keyword lists is the intended tuning.
- Demo data (the fictional Salon Ayu) is invented; no real business or customer data is included.

## Declared behavior

- Environment: reads only the business and script files given. Network: contacts nothing (the engine is offline).
- Writes: only `transcript.md` and `bookings.json` in the `--out` directory.
- This skill never asks for passwords, keys or wallet backup words.
