---
name: story-to-shorts
description: Turn one topic into a complete 45–60 second Shorts production pack — hook-first script in a proven retention framework, timed scene list, overlays, title and hashtags — ready for the Talking-Head pipeline.
---

# Story-to-Shorts — the blank-page killer

Clip tools cut videos that exist; talking-head kits film scripts that exist. This skill creates the script: one topic in, a filmable production pack out.

## The framework (non-negotiable)

1. **Hook ≤ 3 seconds** — question, number or conflict; never a greeting or a title-read.
2. **One idea per sentence** — captions and attention both break on long sentences.
3. **The turn** at the midpoint — a re-opening line exactly where swipe-away peaks.
4. **The close** asks a question answerable in five words, and promises part two.
5. **110–150 words total** — 45–60 seconds at a natural 150 wpm.

## Angles

| Angle | Hook shape |
|---|---|
| mistake | "Stop. You're making the one mistake that kills X…" |
| history | "In the beginning, X was completely different…" |
| myth | "Everything you believe about X is wrong. Here is the proof." |
| numbers | "The numbers behind X make no sense — until you see this one." |
| story | "This is the story of X — and it does not end the way you expect." |

## Deterministic assembler

```
python3 scripts/studio.py --topic "…" --angle mistake --facts facts.txt --out pack/
```

Facts are supplied by the user (one per line, verifiable — the studio structures truth, it does not invent it). Output: `script.txt` (exact Talking-Head pipeline input) + `pack.md` (scenes with per-line timings, title, hashtags). Verified on a real store's real numbers: 130 words ≈ 52s.

## Writing the prose (app mode)

When the user gives a topic without facts, research first (dates and numbers must be real), then draft facts, then assemble. Never publish a pack whose facts you cannot source. Chain: Trend Scout (topic) → this skill (script) → Talking-Head Kit (film) → ClipSmith (cut).

## Declared behavior

- Environment: reads nothing. Network: contacts nothing (the assembler is offline).
- Writes: only `script.txt` and `pack.md` in the `--out` directory.
- This skill never asks for passwords, keys or wallet backup words.
