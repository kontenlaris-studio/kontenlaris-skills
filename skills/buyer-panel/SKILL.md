---
name: buyer-panel
description: Test a product page or offer against a five-persona simulated buyer panel — Skeptic, Bargain Hunter, Impulse Buyer, Technical Buyer, Busy Owner — each scoring willingness to buy, quoting the exact line that decided them, and naming their top fix.
---

# Buyer Panel — simulated buyer research

Real buyers are the only ground truth, but most pages launch with zero. This panel is the pre-flight: five personas with opposed incentives read your page the way their kind actually reads, and every objection must quote your own text — no generic advice survives that rule.

## Step 0 — mechanical pre-screen (deterministic)

```
python3 scripts/prescreen.py page.txt
```

Checks 10 signals buyers scan for (price, what-you-get list, who-for, guarantee, proof, how-it-works, FAQ/limits, CTA, contact, specific numbers) and returns a base score out of 100. The panel starts from these facts; a persona may not claim a signal is missing when the pre-screen found it, nor invent one that is absent.

## The panel

| Persona | Reads for | Kills pages that… |
|---|---|---|
| 🧐 Skeptic | reasons not to trust | claim without showing; unnamed components |
| 💰 Bargain Hunter | the comparison & the math | hide what the bundle saves vs parts |
| ⚡ Impulse Buyer | the first 2 lines, then decides | lead with inventory instead of outcome |
| 🔧 Technical Buyer | requirements, versions, compatibility | sell tools blind |
| ⏰ Busy Owner | "is this for someone like me, how long to set up" | bury fit & setup time at the bottom |

## Output format (exact)

Per persona: **score /10**, a 2–3 sentence verdict **with one verbatim quote** from the page, and **one top fix**. Then: panel consensus (mean score), and a **fix order** ranked by expected impact — each fix phrased as the concrete edit, not a principle.

## Rules

- Simulation is a hypothesis generator, not evidence: label it as such wherever the report travels.
- Never fabricate proof to satisfy the Skeptic — the honest fix is pointing at inspectable demos, docs or repos.
- A guarantee may only be recommended in the narrow form the seller can honor (e.g. delivery/file-works), never invented broad promises.
- Re-run the pre-screen after edits and report the delta; a fix that doesn't move a signal wasn't the fix.

## Declared behavior

- Environment: reads nothing. Network: contacts nothing (the pre-screen is offline; fetch the page yourself if it is online).
- Writes: nothing by itself; reports are written by the agent running the skill, where the user asks.
- This skill never asks for passwords, keys or wallet backup words.
