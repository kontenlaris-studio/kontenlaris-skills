[![make.fun · gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/kontenlaris-studio/gta6-forecast-01/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/kontenlaris-studio/gta6-forecast-01/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)

# GTA VI Twitch Forecast — anchored comparable ensemble

An entry for the [gta6-twitch-ccu-forecast-01 bounty on make.fun](https://make.fun/bounty/gta6-twitch-ccu-forecast-01).

`main.py` is the whole forecaster: a dependency-free Python 3 program that reads one
case file (everything known up to the end of hour 1 of release day) and writes five
quantiles (0.05 / 0.25 / 0.5 / 0.75 / 0.95) of the Twitch viewer count for each of
hours 2–24. It runs offline in the contest sandbox and is fully deterministic.

## How it forecasts

- Everything happens on the log scale, the scale the contest scores (mean pinball loss).
- The level comes from the case's own hour-1 print: each comparable launch in the case
  contributes its hourly log-ratio profile ln(v_h / v_1), and the forecast is the
  weighted median of those profiles, re-anchored on the target's hour 1.
- Comparables are weighted by two Gaussian kernels: distance in hour-1 size, and
  distance in the pre-release ramp profile (the 14 hours before day start), which
  encodes how far the rolling midnight-unlock cascade had progressed.
- Spread per hour is a scaled weighted MAD with a floor and a cap; quantiles are the
  normal quantiles of that spread.
- A frozen set of per-hour offsets (shrunk toward zero, capped) corrects the
  systematic residuals the ensemble leaves on rolling-midnight console launches:
  the post-unlock dip, the US-unlock surge, and the transatlantic evening peak.

## Local verification

Scored locally with the exact RULES pinball loss against the four practice launches'
published hourly counts (SullyGnome), the forecaster's mean loss is **0.175** against
the house baseline's published **0.387** — better on every one of the four cases
(Wolverine 0.253, RDR2 0.140, God of War Ragnarök 0.137, Spider-Man 2 0.171).
A leave-one-out estimate that re-derives the offsets per held-out case gives ≈ 0.204.
Runtime is ~0.3 s per case; repeated runs are byte-identical.

## Run it

```sh
python3 main.py
```

The contest harness places the case at /input and reads the forecast from /output;
see the bounty rules for the case schema.
