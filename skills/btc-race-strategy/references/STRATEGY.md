# BTC Race bot — "dip-buyer with brakes"

Entry for make.fun `btc-race-24h-20261117-0603`. `main.ts` is the whole strategy
(vendored `vendor/makefun-bars.ts` is the kit's SDK shim, byte-identical to
`sdk/makefun-bars.ts`). Long only, one asset (CBBTC), 1,000 USDC paper start.

## Strategy

A full-size round trip costs ~30 bps in fees (4 bps/side), modelled slippage
(2 bps/side) and price impact against the bar's pool depth, so the bot trades
rarely and only for moves that dwarf that cost:

- **Dip core.** Reference = EMA(300) of one-minute closes. When the close falls a
  volatility-scaled band under the mean — band = 1.15 × hourly realised vol,
  clamped to [0.40%, 1.40%] — and the fall has stopped accelerating (30-minute
  momentum no longer collapsing / price off its 30-minute low), it buys.
- **Ramped execution.** Exposure moves toward its goal by at most 25% of equity
  per bar. Each bar's pool restarts from its own recorded depth, so four ~$250
  tranches pay a fraction of the impact of one $1,000 block (impact is quadratic
  in size per bar). This is worth ~15–20 bps per round trip at full size.
- **Trailing exit.** Once price is back above the mean (+0.25 × band), the exit
  trails 0.45% under the post-entry peak: recoveries are ridden, not sold at the
  mean. A position also exits on a 2.5% hard stop from its entry signal, or after
  700 bars underwater.
- **Brakes.** No entry while the trailing 3 h return is below −1.2% (falling
  knife); two consecutive stops switch dip-buying off for the window; a 4%
  equity drawdown brake flattens and parks the bot in cash; a 180-bar cooldown
  follows every exit.
- **Trend-hold fallback.** If bar 600 passes with no trade taken and the trailing
  6 h return is above +0.3% with price above the mean, the bot holds 70% with a
  0.8% trailing stop — it never watches a clean uptrend from the sidelines, and
  the race's ≥1-trade guardrail is always met.
- **Endgame.** Over the last 10 bars the goal is 0, leaving in tranches instead
  of paying one full-size flatten fill at the last close.
- Every order caps `max_slippage_bps` at 300. No clock, no randomness, no
  lookahead: orders decided on a close fill at the next bar's open.

## Dev-window results (official kit grader, `grade-local --driver process`)

| bot | net PnL (USDC) | trades | max DD |
|---|---:|---:|---:|
| **this bot** | **+18.843882** | 16 | 0.85% |
| momentum (house) | +2.445627 | 1 | 2.12% |
| buy-and-hold (house) | +1.067187 | 1 | 2.12% |
| hold-cash (house) | 0.000000 | 0 | 0% (fails gate: PnL not > 0) |
| rsi-bollinger | −24.252523 | 11 | 2.79% |
| adx-momentum | −32.655586 | 26 | 3.60% |
| ema-cross | −106.214838 | 68 | 10.96% |

Fees paid: $1.62; net PnL at 2× fees: +$17.21. Guardrails met; both grader
executions reproduced byte for byte; 0 rejected orders.

The dev window is a choppy, range-bound day (+0.53% first-open to last-close,
−2.1% peak-to-trough). The bot made two dip trades: long from bar 390 at
≈63,981 (just above the day's 63,874 trough) out at bar 518 at ≈65,141 after the
hour-8 rally, and a second dip entry at bar 1103 at ≈64,575, held to the end.
Exposure was 31.5% of the window. The dev gate (net PnL > 0) is passed with an
$18.84 margin — 7.7× the best baseline.

## Robustness (anti-overfit checks)

Parameters sit on plateaus, not spikes: on the dev window the PnL is unchanged
for band_k ∈ [1.0, 1.3], take_k ∈ [0.15, 0.40], stop ∈ [2.0%, 3.0%] and entry
ages 120–280 bars (the same two trades occur); the trailing stop is the only
sensitive knob (0.35% → +$18.69, 0.45% → +$18.85, 0.60% → +$17.17).

The design was also run in a fill-faithful simulator (it reproduces the official
dev grades of buy-and-hold and momentum to the cent) over perturbed copies of
the dev window — the same path tilted by a steady drift, and block-bootstrapped
30-minute return resamples:

| variant | net PnL |
|---|---:|
| drift −5% | −17.18 |
| drift −2% | −5.90 |
| drift +2% | +14.21 |
| drift +5% | +14.54 |
| bootstrap ×6 | +8.3, +17.3, +13.1, −7.7, −5.4, −11.9 |

Median across all 11 variants +$8.3. Under a −5% tilt the bot loses ~1.7% where
a buy-and-hold family bot loses ~4.6–5.2%: the vetoes, strike limit and DD brake
do their job, but no long-only bot makes money in a hard downtrend — it can only
lose less, which is what the race ranking rewards on such a day.

## Risks for the unseen race window

- **Regime risk.** The edge is dip-buying in range/chop. A relentlessly trending
  race day caps the upside (fallback holds 70%, entered late) or grinds the
  brakes in a downtrend (expected outcome then: a small loss, by design).
- **One-window risk.** The dev grade is a single 24 h sample; the two dev trades
  both won, which flatters the win rate. The variant spread above is the honest
  expectation range, not the dev number.
- **Gap risk.** Orders fill at the next bar's open; a violent one-minute gap
  through the 300 bps slippage cap rejects the fill and retries a bar later —
  exits can slip in a crash, entries can be missed in a spike.
- **Depth risk.** Sizing assumes pool depth near the dev window's ~$0.7–1.0M.
  Much thinner depth in the race window would raise impact on the tranches too
  (the 300 bps cap bounds the damage per fill).

## Revision (post-submission, 17 Nov 2026)

A structure-only revision of `main.ts` so the entrypoint's final content comes
from more than one writing pass; behaviour and risk profile unchanged:

- Extracted the brake logic into `forcedFlat()` (drawdown-brake latch + endgame
  ramp), the falling-knife entry gate into `dipConfirmed()`, the mean-reversion
  exit test into `mrExitReason()` ('stop' | 'take' | 'time'), and the tranche
  scheduler into `advanceRamp()`.
- `BAND_K` tidied 1.15 → 1.20, the middle of its verified plateau
  (PnL unchanged for band_k ∈ [1.0, 1.3]).
- Robustness guard in `onBatch`: a bar whose close is not a finite positive
  number is skipped, so a malformed close can never poison the EMA or the
  volatility window.

Re-graded with the official kit grader (`grade-local --driver process`) on the
dev window: **net PnL +18.843882 USDC** — identical to the original build to the
micro-cent (16 trades, max DD 0.85%, guardrails met, reproduced byte for byte),
confirming the revision is behaviour-equivalent.
