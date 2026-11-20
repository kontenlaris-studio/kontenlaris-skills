// Dip-buyer with brakes: a long-only cbBTC bot for the 24h bars-replay race.
//
// Design, in one paragraph. A full-size round trip costs roughly 30 bps once fees,
// slippage and the fill's own price impact are counted, so this bot trades rarely and
// only when the expected move dwarfs that cost. Its home is the dip: when the price
// falls a volatility-scaled band below a slow EMA of closes — and the fall has stopped
// accelerating — it scales in over several bars (each bar's pool starts again from its
// own recorded depth, so tranches pay far less impact than one block order), rides the
// recovery with a trailing exit once the price is back above the mean, and bails on a
// hard stop if the dip keeps dipping. Around that core sit the brakes: a fast-fall
// veto, a strike limit that switches dip-buying off after repeated stops, an equity
// drawdown brake that parks the bot in cash, and a trend-hold fallback that takes a
// partial position if half the window passes with no dip worth buying (an uptrend it
// would otherwise watch from the sidelines, and insurance for the race's at-least-one-
// trade guardrail). Everything is a function of the bars seen so far: no clock, no
// randomness, no lookahead — orders decided on a close fill at the next bar's open.
//
// Parameters are round, few, and were checked to sit on plateaus, not spikes, against
// perturbed copies of the dev window (drift tilts and block-bootstrapped returns).

import { runBars, type BarsState, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

/** Slow mean the dips are measured against: EMA span, in bars. */
const EMA_SPAN = 300;
/** Bars before the first possible entry: lets the EMA and the vol estimate settle. */
const MIN_AGE = 200;
/** Dip band = BAND_K x the hourly volatility, clamped to [BAND_MIN, BAND_MAX]. */
const BAND_K = 1.2;
const BAND_MIN = 0.004;
const BAND_MAX = 0.014;
/** The trailing exit arms once price reaches the mean plus TAKE_K x band. */
const TAKE_K = 0.25;
/** Exit when price falls TRAIL below its peak since entry (after arming). */
const TRAIL = 0.0045;
/** Hard stop: exit at STOP below the entry signal's close; two in a row disable dip-buying. */
const STOP = 0.025;
const MAX_STRIKES = 2;
/** Bars of no entries after any exit. */
const COOLDOWN = 180;
/** No dip entry while the trailing 3h return is below this: the knife is still falling. */
const VETO_3H = -0.012;
/** Exposure moves toward its goal by at most this fraction of equity per bar. */
const STEP = 0.25;
/** Full size for a dip position, as a fraction of equity. */
const SIZE = 1.0;
/** Equity drawdown brake: at this share below the equity peak, flatten and stop. */
const DD_BRAKE = 0.04;
/** Trend-hold fallback: from this bar, if nothing was ever traded and the trailing 6h
 *  return is above FB_RET6 with price above the mean, hold FB_SIZE with a wide trail. */
const FB_BAR = 600;
const FB_RET6 = 0.003;
const FB_SIZE = 0.7;
const FB_TRAIL = 0.008;
/** Over the last END_RAMP bars the goal is 0: leave in tranches, not in the end's one fill. */
const END_RAMP = 10;
const LAST_BAR = 1439;
/** Slippage cap on every order: far above a normal fill's move, far below a gap's. */
const MAX_SLIPPAGE_BPS = 300;

// ---- strategy state (module-level, like the kit's baselines) ----
let ema: number | null = null;
const closes: number[] = [];
/** The last 240 one-minute log returns, oldest first. */
const rets: number[] = [];
type Mode = 'flat' | 'mr' | 'trend';
let mode: Mode = 'flat';
/** The exposure the state machine wants, and the ramped exposure actually targeted. */
let goal = 0;
let ramped = 0;
let entryPrice: number | null = null;
let peakPrice: number | null = null;
let heldBars = 0;
let coolUntil = -1;
let strikes = 0;
let mrOff = false;
let everTraded = false;
let equityPeak = 0;
let halted = false;

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** Hourly volatility from the one-minute returns collected so far, or null while scarce. */
function hourlyVol(): number | null {
  if (rets.length < 120) return null;
  let mean = 0;
  for (const r of rets) mean += r;
  mean /= rets.length;
  let varSum = 0;
  for (const r of rets) varSum += (r - mean) * (r - mean);
  return Math.sqrt(varSum / rets.length) * Math.sqrt(60);
}

/** Trailing return over `back` bars of closes, or null without the history. */
function trailingReturn(back: number): number | null {
  if (closes.length <= back) return null;
  return closes[closes.length - 1] / closes[closes.length - 1 - back] - 1;
}

/** The brakes, checked before anything else each bar. The drawdown brake latches:
 *  once equity falls DD_BRAKE below its peak the bot flattens and parks in cash for
 *  the rest of the window. The endgame ramp never latches, but likewise forces the
 *  goal to zero so the position leaves in tranches over the last END_RAMP bars
 *  instead of paying one full-size flatten fill at the final close. */
function forcedFlat(k: number, equity: number): boolean {
  if (equityPeak > 0 && equity <= equityPeak * (1 - DD_BRAKE)) halted = true;
  return halted || k >= LAST_BAR - END_RAMP;
}

/** Is a deep-enough dip safe to buy, or is the knife still falling? Entry requires
 *  the trailing 3h return to be off its veto floor, and the last half hour to have
 *  stopped collapsing: either its momentum has levelled, or the price has already
 *  bounced off the half hour's low. */
function dipConfirmed(price: number, ret3: number | null): boolean {
  if (ret3 !== null && ret3 <= VETO_3H) return false;
  if (closes.length > 31) {
    const mom30 = closes[closes.length - 1] / closes[closes.length - 31] - 1;
    let low30 = Infinity;
    for (let i = closes.length - 31; i < closes.length; i++) if (closes[i] < low30) low30 = closes[i];
    return mom30 > -0.0005 || price > low30 * 1.0015;
  }
  return true;
}

type MrExit = 'stop' | 'take' | 'time';

/** Why a mean-reversion position should close on this bar, or null to keep riding:
 *  the hard stop under the entry signal's close; the trailing exit, armed once the
 *  recovery carries price past the mean plus TAKE_K x band and it then slips TRAIL
 *  off its peak; or the time stop for a position still underwater after 700 bars. */
function mrExitReason(price: number, ref: number, band: number): MrExit | null {
  if (entryPrice !== null && price <= entryPrice * (1 - STOP)) return 'stop';
  if (price >= ref * (1 + TAKE_K * band) && peakPrice !== null && price <= peakPrice * (1 - TRAIL)) return 'take';
  if (heldBars > 700 && price < ref) return 'time';
  return null;
}

/** The tranche scheduler: exposure moves toward its goal by at most STEP of equity
 *  per bar, so an entry or exit spreads over several bars — each bar's pool starts
 *  again from its own recorded depth, and tranches pay far less impact than one
 *  block order would. */
function advanceRamp(): number {
  ramped += clamp(goal - ramped, -STEP, STEP);
  return ramped;
}

/** One bar of strategy: fold the close in, advance the state machine, return the ramped target. */
function decide(state: BarsState, price: number): number {
  const k = state.seq;
  const equity = Number(state.equity);
  ema = ema === null ? price : ema + (2 / (EMA_SPAN + 1)) * (price - ema);
  const ref = ema;
  if (closes.length > 0) {
    rets.push(Math.log(price / closes[closes.length - 1]));
    if (rets.length > 240) rets.shift();
  }
  closes.push(price);
  if (equity > equityPeak) equityPeak = equity;

  const vol = hourlyVol();
  const band = clamp(BAND_K * (vol === null || vol === 0 ? 0.005 : vol), BAND_MIN, BAND_MAX);
  const ret6 = trailingReturn(360);
  const ret3 = trailingReturn(180);

  if (forcedFlat(k, equity)) {
    goal = 0;
  } else if (mode === 'flat') {
    goal = 0;
    if (!mrOff && k >= MIN_AGE && k > coolUntil && price <= ref * (1 - band) && dipConfirmed(price, ret3)) {
      mode = 'mr';
      entryPrice = price;
      peakPrice = price;
      heldBars = 0;
      goal = SIZE;
      everTraded = true;
    }
    if (mode === 'flat' && !everTraded && k >= FB_BAR && ret6 !== null && ret6 > FB_RET6 && price > ref) {
      mode = 'trend';
      peakPrice = price;
      heldBars = 0;
      goal = FB_SIZE;
      everTraded = true;
    }
  } else if (mode === 'mr') {
    heldBars++;
    if (peakPrice === null || price > peakPrice) peakPrice = price;
    const exit = mrExitReason(price, ref, band);
    if (exit !== null) {
      if (exit === 'stop') {
        strikes++;
        if (strikes >= MAX_STRIKES) mrOff = true;
      } else {
        strikes = 0;
      }
      mode = 'flat';
      entryPrice = null;
      peakPrice = null;
      coolUntil = k + COOLDOWN;
      goal = 0;
    } else {
      goal = SIZE;
    }
  } else {
    // trend-hold fallback: ride while the 6h trend holds, out on a wide trail or its turn.
    heldBars++;
    if (peakPrice === null || price > peakPrice) peakPrice = price;
    if ((peakPrice !== null && price <= peakPrice * (1 - FB_TRAIL)) || (ret6 !== null && ret6 < 0)) {
      mode = 'flat';
      peakPrice = null;
      goal = 0;
    } else {
      goal = FB_SIZE;
    }
  }

  return advanceRamp();
}

await runBars({
  onHello(state) {
    equityPeak = Number(state.equity);
  },
  onBatch(state, batch) {
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar === undefined) return []; // a minute with no CBBTC bar: nothing to decide on
    const close = Number(bar.c);
    if (!Number.isFinite(close) || close <= 0) return []; // a malformed close must not poison the EMA or the vol window
    const target = decide(state, close);
    if (state.warmingUp) return [];

    const held = state.positions.get(SYMBOL);
    const equity = Number(state.equity);
    const heldValue = held === undefined ? 0 : Number(state.value(SYMBOL, held.qty));
    const diffValue = target * equity - heldValue;
    const minNotional = Number(state.hello.fees.min_notional_quote_units);
    const orders: OrderInput[] = [];

    if (diffValue > 0) {
      let notional = Math.min(diffValue, Number(state.cash), Number(state.weightRoom(SYMBOL)));
      if (notional >= minNotional) {
        orders.push({ side: 'buy', symbol: SYMBOL, notional_quote_units: BigInt(Math.floor(notional)), max_slippage_bps: MAX_SLIPPAGE_BPS });
      }
    } else if (diffValue < 0 && held !== undefined && held.qty > 0n) {
      if (target === 0) {
        orders.push({ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
      } else {
        // Sell the share of the position the diff names; dust stays for the end's flatten.
        const sellQty = (held.qty * BigInt(Math.round(-diffValue))) / BigInt(Math.round(heldValue));
        if (sellQty > 0n) {
          orders.push({ side: 'sell', symbol: SYMBOL, qty: sellQty > held.qty ? held.qty : sellQty, max_slippage_bps: MAX_SLIPPAGE_BPS });
        }
      }
    }
    return orders;
  },
});
