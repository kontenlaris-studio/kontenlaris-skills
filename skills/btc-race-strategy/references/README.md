[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/kontenlaris-studio/btc-race-01/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/kontenlaris-studio/btc-race-01/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

# BTC Race bot — vol-scaled dip buying with tranched execution

An entry for the [btc-race-24h-20261117-0603 bounty on make.fun](https://make.fun/bounty/btc-race-24h-20261117-0603):
a bot that trades cbBTC/USDC minute by minute in a replay of on-chain Orca pool
prices, starting from 1,000 USDC of paper money.

`main.ts` is the whole strategy, written against the contest SDK (vendored under
`vendor/`). It is deliberately selective: on the published dev window every active
house baseline lost money to the ~30 bps round-trip cost in a choppy range, so this
bot trades only high-quality dips and lets execution do the rest.

## Strategy

- Under an EMA(300) mean, enter when the close falls 1.15× hourly volatility below
  the mean *and* the fall has stopped accelerating — a dip that is stabilizing,
  not a falling knife (a −1.2%/3h veto and a two-strikes shutoff guard that case).
- Scale in and out in 25%-of-equity tranches: each bar's pool resets, so tranching
  pays a fraction of one block's quadratic price impact (~15–20 bps saved per
  round trip at dev-window depth).
- Exit on a 0.45% trailing stop armed above the mean, a 2.5% hard stop, or a
  700-bar time stop; a 4% equity drawdown brake and 180-bar cooldowns cap damage.
- If 600 bars pass tradeless in an uptrend, a 70% trend-hold fallback keeps the
  bot invested rather than idle; positions are tranched flat over the last 10 bars.

## Dev-window result (official kit grader)

| bot | net PnL (USDC) | trades | max DD |
|---|---:|---:|---:|
| **this bot** | **+18.84** | 16 | 0.85% |
| momentum (house) | +2.45 | 1 | 2.12% |
| buy-and-hold (house) | +1.07 | 1 | 2.12% |
| rsi-bollinger | −24.25 | 11 | 2.79% |
| adx-momentum | −32.66 | 26 | 3.60% |
| ema-cross | −106.21 | 68 | 10.96% |

Parameters sit on verified plateaus, and a fill-faithful simulator stress test
(drift tilts and bootstraps of the dev window) gives a median of about +$8 with
worst-case variants near −1.7% — by design, bad days lose small. See NOTES.md.

## Run it

The contest harness runs the bot bar by bar:

```sh
node main.ts
```

Locally, grade it on the dev window with the kit's `grade-local` tool.

## SkillSafe registry edition

This package is also published on the SkillSafe registry as
`@kontenlaris-studio/btc-race-strategy` for verified, scan-checked installs.
The strategy content is identical to the GitHub release.
