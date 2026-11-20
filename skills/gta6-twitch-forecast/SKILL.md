---
name: gta6-twitch-forecast
description: A dependency-free Python forecaster for launch-day Twitch viewership - an hour-1 anchored comparable ensemble producing five quantiles for hours 2-24. Use when an agent needs quantile forecasts for a launch event from a single early data point plus comparable launches.
---

# GTA VI Twitch Forecast - anchored comparable ensemble

A dependency-free Python 3 program that reads one case file (everything known up to the end of hour 1 of release day) and writes five quantiles (0.05 / 0.25 / 0.5 / 0.75 / 0.95) of the Twitch viewer count for each of hours 2-24. Fully deterministic, runs offline in about 0.3 s per case.

## How it forecasts

- Everything happens on the log scale, the scale the contest scores (mean pinball loss).
- The level comes from the case's own hour-1 print: each comparable launch contributes its hourly log-ratio profile ln(v_h / v_1), and the forecast is the weighted median of those profiles, re-anchored on the target's hour 1.
- Comparables are weighted by two Gaussian kernels: distance in hour-1 size, and distance in the pre-release ramp profile (the 14 hours before day start), which encodes how far the rolling midnight-unlock cascade had progressed.
- Spread per hour is a scaled weighted MAD with a floor and a cap; quantiles are the normal quantiles of that spread.
- A frozen set of per-hour offsets (shrunk toward zero, capped) corrects systematic residuals on rolling-midnight console launches: the post-unlock dip, the US-unlock surge, and the transatlantic evening peak.

## Verified results (stated honestly)

Scored locally with the exact contest pinball loss against the four practice launches' published hourly counts, the forecaster's mean loss is 0.175 (v2: practice 0.1656) against the house baseline's 0.387 - better on every practice case. A leave-one-out estimate is about 0.19-0.20, which is the more honest expectation for unseen launches. The real GTA VI result is not known yet; no outcome is promised.

## Environment disclosure

`scripts/main.py` reads two environment variables, `MAKEFUN_INPUT_DIR` (default `/input`) and `MAKEFUN_OUTPUT_DIR` (default `/output`), only to locate the case file and the forecast output. It reads nothing else, stores nothing, and makes no network calls.

## Using it

`python3 scripts/main.py` with the case at /input and the forecast read from /output; the case schema and design notes are in `references/README.md` and `references/NOTES.md`.

## Commercial licensing

This engine is also available under a perpetual commercial license for embedding in your own products — Indie $149 / Commercial $449 / Studio $1,199, plain-English terms and full catalog: https://kontenlaris-studio.github.io/engine-licensing/ · order via kontenlaris.studio@gmail.com. Installing this skill from the registry stays free under registry terms; the license covers shipping the engine's source inside a commercial product.
