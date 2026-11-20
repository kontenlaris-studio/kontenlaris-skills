---
name: trend-scout
description: Research what actually happened around a topic in the last 30 days — Hacker News, new GitHub repos and Google News — and synthesize a brief where every claim carries its date and source.
---

# Trend Scout — grounded last-30-days research

Most "trend research" is a language model remembering vibes. This skill only reports what keyless public sources published inside the window, each line dated and linked, then synthesizes patterns across them.

## Run it

```
python3 scripts/riset.py "your topic" [--days 30] [--limit 8]
```

The script queries three sources that need no API key:
- **Hacker News** (Algolia API) — stories in the window, ranked by points: what practitioners argued about.
- **GitHub Search** — repositories *created* in the window, ranked by stars: what builders actually shipped.
- **Google News RSS** — headlines in the window: what the press covered.

A source that fails is reported as unavailable in the brief — never silently replaced with guesses.

## How to write the brief

1. Run the script; keep its raw output as the evidence base.
2. **Signals**: 3–5 bullets of what repeats across ≥2 sources (a launch pattern, a rising category, a controversy).
3. **Notable items**: the top items per source, each with date + link, one line on why it matters.
4. **So what**: for a builder/seller — the opportunity the signals imply, and its expiry (trend windows close).
5. Never add a fact that is not in the evidence base; mark interpretation as interpretation.

## UMKM mode (Indonesia)

For Indonesian small-business topics, run twice: once in English (global supply side — tools, formats, prices) and once in Bahasa Indonesia via Google News (local demand side — what local media and buyers are discussing). The gap between the two briefs is usually the opportunity: formats proven globally that local coverage hasn't picked up yet.

## Declared behavior

- Network: contacts hn.algolia.com, api.github.com, news.google.com only, for the queries above.
- Environment: reads nothing. Writes: nothing (the brief prints to stdout).
- This skill never asks for passwords, keys or wallet backup words.

## Limits

Headlines are claims, not facts — open the strongest sources before acting on them. GitHub's unauthenticated search is rate-limited; space repeated runs a minute apart.
