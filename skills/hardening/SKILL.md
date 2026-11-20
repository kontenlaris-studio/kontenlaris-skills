---
name: hardening
description: Harden an AI agent skill that passed review with notes — least-privilege environment, network allowlists, write scoping, disclosure writing and safe structure — until it passes a clean re-audit.
---

# Hardening — from "probably fine" to defensibly safe

Use this after skill-audit + skill-reviewer leave you with medium/low findings or prose concerns. The goal is a skill whose *structure* makes whole attack classes impossible, not one that merely avoids today's patterns.

## Principles

1. **Split the dangerous pairs.** Exfiltration needs two capabilities in reach of each other. Keep environment reads, network calls and file writes in separate modules with narrow interfaces (the bundle's own layout is an example: config reads env, transport does network, logic does neither).
2. **Allowlist, don't blocklist.** Name the exact domains, paths and variables the skill may touch — in code and in its SKILL.md. Anything not named is out of bounds.
3. **Write the disclosure like a contract.** A "Declared behavior" section that lists every env var, domain and file write. If a future version adds one, the diff is visible — that visibility *is* the security control.
4. **No runtime instruction fetching.** Pin everything the agent will obey inside the reviewed package. Updates arrive as new versions that get re-reviewed.
5. **Fail closed.** Missing credential, unexpected domain, oversized input → stop with a clear message, never improvise a fallback that widens access.
6. **Secrets never transit the skill.** Credentials come from the platform's vault/connector at call time; the skill never reads, stores, logs or echoes them.

Step-by-step procedures per capability live in `references/HARDENING.md`. Finish by re-running skill-audit and attaching the clean report to the skill's repo — public evidence beats promises.
