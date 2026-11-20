---
name: token-radar
description: A pre-token protocol screener that ranks protocols by implied launch value - TVL times a category multiple learned from tokenized peers, adjusted for 7-day momentum and age. Use when an agent needs a transparent, reproducible way to rank pre-token protocols and plan around potential launches.
---

# Token Radar - Launch Multiple Radar

A token launch radar over a sealed DefiLlama snapshot (14 Nov 2026): 180 pre-token protocols ranked by implied launch value.

## The model

Implied value = TVL x category multiple x momentum adjustment x age adjustment, where:

- The category multiple is learned from the snapshot's own tokenized protocols (median market cap / TVL per category), shrunk toward the global median for thin categories so small samples cannot produce extreme multiples.
- Momentum adjusts for the protocol's 7-day TVL change; age adjusts for how long the protocol has been tracked.
- Every ranked row carries the full value breakdown and its comparables, plus a 7-step plan for positioning around a potential launch.

`scripts/main.ts` reads a snapshot and writes the ranked board; `references/README.md` and `references/NOTES.md` document the run and the model choices.

## Honest limits

Implied value is a screening heuristic, not a price prediction: most pre-token protocols never launch a token, multiples compress or expand with market conditions, and the snapshot is frozen at 14 Nov 2026. Use the ranking to decide what to research first, never as investment advice.

## Commercial licensing

This engine is also available under a perpetual commercial license for embedding in your own products — Indie $149 / Commercial $449 / Studio $1,199, plain-English terms and full catalog: https://kontenlaris-studio.github.io/engine-licensing/ · order via kontenlaris.studio@gmail.com. Installing this skill from the registry stays free under registry terms; the license covers shipping the engine's source inside a commercial product.
