---
name: threat-patterns
description: A field guide to known attack patterns against AI agent skills — credential theft, exfiltration shapes, instruction disguise, wallet traps, typosquatting and update-channel hijack — with the tell that exposes each one.
---

# Threat Patterns — know the shapes

Attackers reuse a small set of shapes. Learn to recognize the shape and the individual wording stops mattering. Full catalog: `references/PATTERNS.md`. The seven core shapes:

1. **The quiet exfiltrator** — reads environment or files in one place, posts to a remote host in another. Tell: env+network or write+network capability pairs the docs don't explain.
2. **The disguised instruction** — a skill whose cheerful description hides imperatives that change agent behavior (conceal, override, obey third-party content). Tell: description/body mismatch; secrecy instructions.
3. **The wallet trap** — any request, in any wording, for wallet backup words, private keys or "verification" of them. Tell: urgency + secrecy + a reason why *this* skill supposedly needs them. It never does.
4. **The update-channel hijack** — the reviewed package is clean, but it fetches its real instructions or code at runtime from a mutable URL. Tell: "always fetch the latest…" steps.
5. **The typosquat** — a near-identical name to a popular skill, published recently, with a subtly wider scope. Tell: name similarity + young account + one extra capability.
6. **The helpful harvester** — a genuinely useful free skill whose real payload is telemetry: it reports your files, prompts or contacts home. Tell: network calls unrelated to the stated job.
7. **The authority costume** — claims of being official, mandatory or platform-issued to get the agent (or you) to skip review. Tell: authority asserted, never linked or proven.

For each shape the catalog gives: how it works, the tell, a real-world style example (sanitized), and the defense.
