---
name: faceless-channel
description: Turn one niche into a complete 30-day faceless YouTube/TikTok channel pack — content calendar, a filmable script per slot in the Talking-Head format, posting schedule, checklists and setup templates for 5 niches.
---

# Faceless Channel — the whole month, planned in one run

Faceless channels rarely fail on ideas; they fail on the blank calendar, the unwritten script and the random posting day. This skill chains the studio's five modules into one workflow and produces the entire month up front.

## The chain

1. **Trend Scout** — pick topics from dated, real signals.
2. **Story-to-Shorts** — assemble each script (hook ≤ 3s, one idea per sentence, mid-point turn, comment-earning close).
3. **Talking-Head Kit** — render script + one photo + one voice file into a vertical video with burned-in subtitles.
4. **ClipSmith** — caption and clip plan from the same script.
5. **Launch Autopilot** — posting cadence, launch-day rhythm and the comment-reply rota.

## Deterministic orchestrator

```
python3 scripts/faceless.py --niche history --out my-channel/
python3 scripts/faceless.py --topics topics.json --out my-channel/ --per-week 5
python3 scripts/faceless.py --selftest
```

Niches: `finance` · `history` · `health` · `tech` · `motivation`. Topics JSON: `[{"topic": "…", "angle": "myth", "facts": ["…", "…"]}]`; angles `mistake | history | myth | numbers | story`. Output: `calendar.csv` + `calendar.md` (30 days at the chosen cadence), one `scripts/day-XX-*/` folder per video with `script.txt` in the exact Talking-Head pipeline format plus a timed `pack.md`, `schedule.md`, `checklist.md`, `channel-setup.md` (name, banner and description templates for all 5 niches) and `pack-summary.md`. Self-test: 12/12 checks on a generated pack.

## Honest scope

- Faceless means no on-camera presence: a consistent avatar image, a voice track and subtitles carry each video.
- Voice is supplied by the user — their own recording, or any text-to-speech service they choose. This skill offers no voice cloning and claims none.
- Facts in a script come from the user or the niche bank; the per-video checklist starts with checking them against a real source. The pack guarantees structure and schedule, never virality.

## Declared behavior

- Environment: reads nothing beyond the topics file given. Network: contacts nothing (the orchestrator is offline).
- Writes: only the pack files in the `--out` directory.
- This skill never asks for passwords, keys or wallet backup words.
