# GTA VI Twitch CCU forecast — build notes

Entry for make.fun `gta6-twitch-ccu-forecast-01`. `main.py` (Python 3.13,
standard library only) reads one case file per run and writes, for hours
2..24 of the launch day, five quantiles (0.05/0.25/0.5/0.75/0.95) of that
hour's mean concurrent viewers. Scoring is mean pinball loss on the log
scale; lower is better.

## Practice results (local, exact RULES scoring)

Practice answers are the four launches' SullyGnome release-day hourly
averages, fetched once from the same public endpoints the kit's NOTICE.txt
documents and validated before use: each fetched hour-1 value reproduces
its case's `known` print exactly (23357 / 116550 / 269517 / 119087), and no
release-day hour is missing. The local scorer implements the RULES formula
verbatim and reproduces the house baseline's published practice loss
(0.3871 vs "about 0.387"), which validates both the answers and the scorer.

| case | launch | this entry | house baseline |
|------|--------|-----------:|---------------:|
| p00 | Marvel's Wolverine (2026-09-15) | 0.2531 | 0.7436 |
| p01 | Red Dead Redemption 2 (2018-10-26) | 0.1398 | 0.2868 |
| p02 | God of War Ragnarök (2022-11-09) | 0.1366 | 0.2146 |
| p03 | Marvel's Spider-Man 2 (2023-10-20) | 0.1708 | 0.3033 |
| **mean** | | **0.1751** | **0.3871** |

90% coverage of the shipped forecasts: 0.96 / 1.00 / 0.96 / 0.91 per case.
Runtime ~0.3 s per case (cap 8 s); two runs of every case are byte-identical.

Other reference points on the same scorer: flat persistence (all quantiles
= hour 1) 0.6029; unweighted anchored ensemble with empirical quantiles
0.3240; the final model without its per-hour offsets 0.2244. A
leave-one-out estimate of the shipped configuration (offsets re-derived
from the other three cases each time) is ≈ 0.204, so the honest
generalisation estimate is ~0.20 rather than the in-sample 0.175.

## Model

All in log space, anchored on hour 1's print p1:

1. Each comparable contributes its release-day log-ratio curve
   r_c(h) = ln v_c(h) − ln v_c(1), hours taken from its `hourly` rows
   inside its own `day_start` UTC day. Comparables with no hour-1 point
   are skipped; missing hours are skipped per hour.
2. Weights: Gaussian kernel on |ln c1 − ln p1| (bandwidth 1.0) times a
   Gaussian kernel on the pre-release ramp distance (bandwidth 0.65).
   The ramp is the log-viewer profile relative to hour 1 over the 14
   hours before day start; distance is the mean absolute gap over shared
   hours (needs ≥ 4 shared, else no ramp factor). The ramp encodes how
   far through the regional unlock cascade the audience already was at
   hour 1, which is what separates a flat day from an evening-peak day.
3. Location per hour: weighted median of r_c(h), plus a frozen per-hour
   offset (below). Spread per hour: 1.4826 × weighted MAD of r_c(h),
   scaled ×0.9, floored at 0.12, capped at 0.95. Quantiles are
   exp(centre + z·sigma) with normal z (Acklam's approximation), then
   clamped to (0, 1e9], made non-decreasing, rounded to 2 decimals.

## The per-hour offsets (bias correction)

Residuals of the un-offset ensemble on the four practice cases are not
noise: they are negative at hours 2–4 (post-midnight dip runs deeper than
the mixed ensemble thinks), strongly positive at hours 5–7 (US East
unlock surge) and hours 17–24 (transatlantic evening peak, up to +0.56
mean log residual at hour 18), negative again at hour 12. The four
practice targets and GTA VI are all rolling-midnight console launches,
while the comparable pool also holds global/simultaneous and
early-access-contaminated launches whose days run flatter relative to
hour 1 — that mismatch is what the offsets correct. Frozen offsets =
0.7 × the per-hour mean residual, capped at ±0.35 (hours 18 and 21 sit
at the cap). Leave-one-out validation: the correction improves the two
cases with the strongest unlock geography (Wolverine 0.359→0.309,
RDR2 0.196→0.154 at bandwidth 0.65) and is roughly neutral on the other
two, mean 0.224→0.204 — it generalises, but the shipped in-sample number
still flatters it.

## Design decisions

- Weighted median + MAD rather than empirical ensemble quantiles:
  empirical quantiles scored worse (0.32–0.33) because a handful of
  extreme comparables (slow-burn or late-unlock titles whose hour 1 is a
  few hundred viewers) put absurd mass in the tails; the robust normal
  form resists them. Filtering small-hour-1 comparables out entirely
  was tried and rejected — it wrecked Wolverine (0.43→0.66), whose own
  hour 1 is small; the size kernel is the soft version of that filter.
- Text-based unlock classification (parsing the free-text `unlock`
  field) was tried as weights and dropped: two thirds of the pool lands
  in an "unverified/other" bucket, and it scored no better than the
  data-driven size + ramp kernels.
- Platform weighting (PS5/Series ×1.5) was tried and dropped (no gain).
- Asymmetric (wider upper) tails were tried and dropped (no gain once
  the offsets are in).
- The target's own post-hour-1 information does not exist by
  construction (checkpoint = end of hour 1); its pre-checkpoint ramp is
  the only trajectory signal, hence the ramp kernel.

## Final-case handling

- `streams` and `categories_hourly` are read by nothing: the model
  deliberately ignores them (the top-20 stream snapshot is a single
  instant and adds no identified signal beyond hour 1's print and the
  ramp). Their presence changes nothing and cannot crash the run.
- The final's `history` is minute reads. The ramp uses `history_hourly`
  (present in the final); if a case ever lacked it, the program averages
  the raw history points into whole hours itself — verified on a
  synthetic minute-history case to reproduce the hourly-ramp output
  exactly.
- The final's comparables include all 42 launches (the four practice
  launches join the pool, plus the GTA VI category's own premiere-day
  curve); the program treats them uniformly. GTA VI's scale is handled
  by the hour-1 anchor — nothing is capped at comparable maxima.
- Degenerate inputs degrade gracefully: no comparables → offsets plus a
  random-walk spread around p1; an hour no comparable covers → previous
  hour's median with the fallback spread; malformed timestamps are
  skipped row by row instead of crashing (an invalid case is the one
  unforgivable outcome, so the parser is deliberately forgiving).
- Determinism: pure function of the input bytes — no clock, no random
  source, no set iteration in any output-affecting order.

## Limitations (honest)

- Four practice cases is a tiny calibration set. The offsets are the
  main overfitting risk; shrinkage (0.7) and the ±0.35 cap are the
  mitigation, and the leave-one-out estimate (~0.20) is the number to
  believe, not 0.175.
- The practice prints are SullyGnome hourly averages (one point an
  hour); the final's prints are means of ~60 minute reads of a
  different instrument (Twitch's directory count). Hour-1 anchoring
  absorbs level differences, but hour-to-hour noise characteristics
  differ somewhat.
- GTA VI is plausibly far bigger than every comparable, and its
  audience mix (a decade of pent-up demand, heavy US share) may push
  the evening peak beyond anything in the pool; the offsets lean that
  way but cannot prove it.
- The model has no notion of weekday, marketing events on the day, or
  server/outage shocks; the spread is where those live.
- The other bar on the final is the house model forecast (an AI model's
  ratios and spreads, made before hour 1 on history alone). It cannot
  be scored locally; the practice margin over the baseline (0.175 vs
  0.387) is the only guide, and the rules warn a practice score is no
  guide to the final.

## Revision (2026-11-18, the day before the final run)

Three changes, each kept only because it improved leave-one-out on the
practice cases (offsets re-derived per fold) and did not rely on fitting
the four cases harder; a second suite of 148 pseudo-cases (each practice
comparable in turn as the target, offsets never applied there) backed
the structural changes:

1. **Location blend.** The per-hour centre is now 0.15 × weighted median
   + 0.85 × weighted mean of the log-ratios (spread still the weighted
   MAD, now around the blended centre). The step-median centre jumps
   hour to hour; the blend smooths it. LOO 0.204 → 0.199 alone, pseudo
   0.471 → 0.438.
2. **Gentler ramp kernel.** Ramp bandwidth 0.65 → 2.0. A tight kernel
   shrinks the effective pool until the centre is mostly a few
   ramp-twins; both suites prefer the gentle tilt (LOO and pseudo both
   keep improving out to bandwidth 3 and to no kernel at all; 2.0 keeps
   some discrimination against truly alien ramps at no measured cost).
3. **Offsets re-derived** against the new base, same protocol (0.7 ×
   mean residual), cap tightened ±0.35 → ±0.30 (the tighter cap scored
   better in LOO on both the old and the new structure). Hours 5, 6
   and 18 sit at the cap.

Result: practice (in-sample) 0.1751 → **0.1656**; honest leave-one-out
0.2039 → **0.1885**. Per-case LOO: Wolverine 0.309 → 0.269, God of War
0.151 → 0.136, Spider-Man 2 0.203 → 0.191, RDR2 0.154 → 0.158 (the one
small regression, accepted for the larger gains elsewhere).

Rejected on the numbers (each helped the pseudo suite, each hurt LOO —
the pseudo pool is full of odd launches whose days are genuinely less
predictable, and GTA VI belongs to the practice targets' class, not to
the pseudo average): Student-t tails (t4–t10), spread scale above 0.9,
sigma growing with hour, interpolated weighted median, winsorised or
trimmed mean blends, offset smoothing across hours, median-of-residuals
offsets, ramp distance without the hour-1 point, and a pooled-shape
prior comparable.

## Resubmission record (2026-11-18)
- v2 submitted signed, REPLACING v1 as the counted entry: submission_id 01a1ed55-7e1b-762d-aab4-0e90ff6fb17b, claim code AF-DJVP2-VP3QF-M02RC-A28FS, commit 6d4358009d5cd692dcb9b88fcec84e373259531a, stage "scored", 0 failed checks (28 total). Verified improvements: practice pinball 0.1751 → 0.1656, leave-one-out 0.2039 → 0.1885. The house runs this program on the real case at the deadline 19 Nov 2026 08:00 WIB; result due 4 Dec 2026.
