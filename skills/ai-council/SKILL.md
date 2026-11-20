---
name: ai-council
description: Decide with a five-seat adversarial council — Investor, Customer, Engineer, Risk Counsel, Skeptic — that argues in three rounds and votes GO / GO_WITH_CONDITIONS / NO_GO, with conditions merged and disagreements recorded, not smoothed over.
---

# AI Council — decisions argued before they're taken

A single AI answer tends to agree with you and miss the expensive blind spot. The council fixes the incentives: five seats with opposed interests argue a decision in the open, and a council that always agrees is a failed council.

## The seats

| Seat | Only cares about |
|---|---|
| 💼 Investor | Does it make money, how fast, what's the expected value |
| 🛒 Customer | Would the buyer/judge actually choose this, and why not |
| 🔧 Engineer | Real build & maintenance cost in days, stack risk |
| ⚖️ Risk Counsel | What can explode: platform rules, law, tax, reputation |
| 🧨 Skeptic | Why this fails within 90 days, stated as a story |

## Protocol (three rounds, exact)

1. **Opening verdicts** — each seat: GO / GO_WITH_CONDITIONS / NO_GO, its single strongest argument, and measurable conditions (never "be careful" — conditions must be checkable).
2. **Rebuttal** — each seat must answer the strongest objection raised against its position by another seat; repeating round 1 is forbidden.
3. **Vote** — seats may flip, and flips are recorded with the reason. The session file is written in the tally format; `scripts/tally.py` counts it deterministically: majority GO → GO, majority NO_GO → NO_GO, otherwise GO_WITH_CONDITIONS with all conditions merged and deduplicated.

## Output (exact)

The session markdown (per-seat sections with votes + conditions), the tally verdict, and a **Recorded disagreement** section preserving the strongest unresolved clash verbatim in substance. Smoothing disagreement away is the one unforgivable edit.

## Rules

- The council works from facts that are sourced (prize clauses, deadlines, rules); anything unsourced is flagged as unverified inside the session itself, and an unverified load-bearing fact automatically becomes one of the conditions.
- The council advises; the human decides. Never present a verdict as the user's decision.
- One question per session. Bundled questions produce mush.

## Declared behavior

- Environment: reads nothing. Network: contacts nothing (tally is offline).
- Writes: the session file, where the user asks.
- This skill never asks for passwords, keys or wallet backup words.
