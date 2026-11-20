---
name: btc-race-dip-buyer
description: A volatility-scaled dip-buying strategy for cbBTC/USDC on one-minute bars. Long-only, tranched execution, trailing exit, hard stop, drawdown brake and a trend-hold fallback. Use when an agent needs a complete, deterministic BTC dip-buying bot that trades rarely, only on high-quality dips, and keeps bad days small.
---

# BTC Dip Buyer — volatility-scaled, tranched, with brakes

A complete, self-contained trading strategy in a single TypeScript file
(`scripts/main.ts`, 257 lines, no dependencies beyond the vendored bars SDK in
`scripts/vendor/`). It was built for a 24-hour cbBTC/USDC bars-replay race on
make.fun and finished its official dev-window grading ahead of every house
baseline.

The strategy is a pure function of the bars seen so far: no clock, no
randomness, no lookahead. Orders decided on a bar's close fill at the next
bar's open.

## When to use this skill

- You want a BTC (or any single-asset, long-only) dip-buying bot that trades
  rarely and only when the expected move dwarfs the ~30 bps round-trip cost of
  fees, slippage and price impact.
- You are backtesting or racing strategies against a one-minute bars feed.
- You want risk brakes by default: falling-knife veto, strike limit, equity
  drawdown brake, cooldowns, and a tranched endgame exit.

## How to run it

The bot speaks the bars-harness protocol implemented by the vendored SDK
(`scripts/vendor/makefun-bars.ts`): the harness calls `onHello` once, then
`onBatch` for each batch of one-minute bars, and the bot returns orders.

```sh
node scripts/main.ts   # Node 22+, run by a bars harness that feeds CBBTC bars
```

To run it against your own feed (for example market-data tools that return
one-minute candles), implement the small `BarsState` / `OrderInput` interface
from `scripts/vendor/makefun-bars.ts` — the strategy logic in `main.ts` does
not care where the bars come from. Starting equity in the original race was
1,000 USDC of paper money; position sizing is expressed as a fraction of
equity, so it scales to any account size.

## Strategy in brief

- **Dip core.** Reference price is an EMA(300) of one-minute closes. A dip is
  buyable when the close falls a volatility-scaled band below the mean —
  band = 1.2 × hourly realised volatility, clamped to [0.40%, 1.40%] — *and*
  the fall has stopped accelerating (30-minute momentum levelled, or price
  already off its 30-minute low).
- **Tranched execution.** Exposure moves toward its goal by at most 25% of
  equity per bar. Each bar's pool restarts from its own recorded depth, so
  four ~25% tranches pay a fraction of the price impact of one block order
  (~15–20 bps saved per round trip at dev-window depth).
- **Exits.** A trailing exit (0.45% under the post-entry peak) arms once price
  recovers above the mean + 0.25 × band; a 2.5% hard stop from the entry
  signal's close; a 700-bar time stop while underwater.
- **Brakes.** No entry while the trailing 3-hour return is below −1.2%
  (falling knife); two consecutive stops switch dip-buying off for the rest of
  the window; a 4% equity drawdown brake flattens and parks the bot in cash;
  a 180-bar cooldown follows every exit.
- **Trend-hold fallback.** If bar 600 passes tradeless and the trailing
  6-hour return is above +0.3% with price above the mean, hold 70% with a
  0.8% trailing stop — the bot never watches a clean uptrend from the
  sidelines.
- **Endgame.** Over the last 10 bars of the window the goal is 0, leaving in
  tranches instead of paying one full-size flatten fill.

Every order caps `max_slippage_bps` at 300.

## Key parameters (all in `scripts/main.ts`)

| Parameter | Value | Meaning |
|---|---|---|
| `EMA_SPAN` | 300 | Slow mean, in bars |
| `BAND_K` | 1.2 | Dip band = K × hourly volatility |
| `BAND_MIN` / `BAND_MAX` | 0.40% / 1.40% | Band clamps |
| `TRAIL` | 0.45% | Trailing exit distance |
| `STOP` | 2.5% | Hard stop below entry signal |
| `STEP` | 25% | Max exposure change per bar |
| `DD_BRAKE` | 4% | Equity drawdown brake |
| `VETO_3H` | −1.2% | Falling-knife veto on 3h return |
| `FB_SIZE` | 70% | Trend-hold fallback size |

Parameters were checked to sit on plateaus, not spikes, against perturbed
copies of the dev window (drift tilts and block-bootstrapped returns).

## Verified results — stated honestly

Official dev window, graded with the contest kit's own grader:

| bot | net PnL | trades | max DD |
|---|---:|---:|---:|
| **this bot** | **+$18.84 (+1.88%)** | 16 | 0.85% |
| momentum (house) | +$2.45 | 1 | 2.12% |
| buy-and-hold (house) | +$1.07 | 1 | 2.12% |
| rsi-bollinger (house) | −$24.25 | 11 | 2.79% |
| ema-cross (house) | −$106.21 | 68 | 10.96% |

In the subsequent live 24-hour race the same code finished at **−0.12%**
(17 trades, max DD 0.97%) — a choppy window with no qualifying dip recovery.
That is the design working as intended: bad days lose small. A
fill-faithful stress test (drift tilts and bootstraps of the dev window)
gives a median of about +$8 with worst-case variants near −1.7%.

## Risks

- This is a strategy, not financial advice. It can and does lose money in
  choppy or persistently falling markets (see the live-race result above).
- It is long-only and single-asset; it does not hedge, short, or diversify.
- Past dev-window and race results do not predict future returns.

## Contents

- `SKILL.md` — this file
- `scripts/main.ts` — the whole strategy
- `scripts/vendor/makefun-bars.ts` — the bars-harness SDK the strategy runs against
- `references/STRATEGY.md` — design notes and full dev-window grading table
- `references/README.md` — original repository readme
- `LICENSE` — MIT

Original public repository: https://github.com/kontenlaris-studio/btc-race-01
(MIT licensed). Author: Kontenlaris Studio.
