---
name: ugc-ad-generator
description: Turn one product (name, price, benefits, audience) into 10 filmable UGC-style ad variants — script in the Talking-Head format, shot list, timed captions and hook line per angle — with a deterministic banned-claim compliance guard.
---

# UGC Ad Generator — ten ads per product, none of them fake

Sellers pay $50–150 for one human UGC video, mostly for the script and the structure. This skill generates the whole set as production paperwork: ten angles, each with a filmable script, a timed shot list, word-timed captions and the hook line for the text overlay — ready to film yourself, hand to a creator, or render with the Talking-Head Kit.

## The 10 angles

Problem/solution · unboxing · testimonial **template** · comparison · before/after (process-only, claim-free) · FAQ · myth-bust · routine · gift · honest urgency (a real reason to act, never invented scarcity).

## Deterministic engine

```
python3 scripts/ugc.py --product product.json --out my-ads/
python3 scripts/ugc.py --selftest
```

Product JSON: `{"name": "…", "price": "…", "benefits": ["…", "…"], "audience": "…", "platform": "tiktok|shorts|reels", "language": "en|id"}`. Output: one folder per variant with `script.txt` in the exact Talking-Head pipeline format (hook → body → benefits → mid turn → close, following the Story-to-Shorts retention framework), `shotlist.md`, `captions.srt` (150 wpm timing) and `hook.txt`, plus `compliance.md` and `pack-summary.md`. Self-test: 9/9 checks.

## The compliance guard

Every generated line, plus any `custom_lines` in the product JSON, is screened against a deterministic banned-claim wordlist before it reaches the pack: invented results, fake discounts, false scarcity or deadlines, medical and financial promises, unverifiable superlatives, invented social proof. Hits are listed in `compliance.md`, and a variant whose assembled script trips the guard is withheld rather than shipped.

## Honest scope

- The testimonial variant is a labelled TEMPLATE: its lines are bracketed placeholders for the creator's own real experience. It is never a fabricated review, and the pack says so in the script itself.
- A script can only repeat the benefits in the product JSON — the engine adds structure, not claims. The seller stays responsible for their marketplace and country ad rules.
- Voice is supplied by the user — their own recording, a hired creator, or any text-to-speech service they choose. This skill offers no voice cloning and claims none.

## Declared behavior

- Environment: reads nothing beyond the product JSON given. Network: contacts nothing (the engine is offline).
- Writes: only the pack files in the `--out` directory.
- This skill never asks for passwords, keys or wallet backup words.
