---
name: launch-autopilot
description: Turn one product's facts into a complete launch pack — Product Hunt, DevHunt and Show HN copy in each platform's voice, social posts, an asset checklist and an hour-by-hour launch-day schedule.
---

# Launch Autopilot — "live" is not "launched"

Most indie products never launch; they go live quietly and wait to be found. This skill produces the launch: six files, each in the voice its platform rewards.

## The generator (deterministic core)

```
python3 scripts/launchkit.py facts.json --out launch-pack/
```

Facts: `{name, url, tagline, what, problem, audience, stack, proof, maker}`. Output: `producthunt.md`, `devhunt.md`, `showhn.md`, `social.md`, `checklist.md`, `schedule.md`. Verified on a real product pack (InvoiceKit).

## Platform rules the pack enforces

- **Product Hunt:** tagline ≤ 60 chars (auto-trim with a warning, never silently), the maker's first comment written in advance and posted within 5 minutes of 00:01 PT, a human replying to every comment within the hour.
- **DevHunt:** lead with the engineering angle — stack, constraints, what was hard.
- **Hacker News:** `Show HN: Name – what it does`, plain technical voice, zero marketing adjectives. **Never ask for upvotes, anywhere, ever** — it is bannable on HN and corrosive everywhere else.
- One product per launch day. Launching everything at once spends all your stories on one news cycle.

## Honesty rules

- Copy is assembled from the facts file only: no invented features, metrics or testimonials. A missing proof point stays missing (or becomes a T-1 task), never a fabrication.
- The T+1 retro posts real numbers — rank, visits, conversions — good or bad. That retro is part of the pack, not an optional extra.
- Scheduling a launch is the user's decision; the kit prepares, it does not submit.

## Declared behavior

- Environment: reads nothing beyond the facts file given. Network: contacts nothing.
- Writes: only the six pack files in the `--out` directory.
- This skill never asks for passwords, keys or wallet backup words.
