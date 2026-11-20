---
name: skill-audit
description: Audit an AI agent skill for security risks before installing or publishing it — credential access, environment reads, network calls, execution, file writes and exfiltration-shaped combinations — and produce a graded report with file-and-line evidence.
---

# SkillAudit

Know what a skill really does before it runs with your credentials, files and network.

## What it checks

Run `scripts/audit.py <skill-folder>` (stdlib-only Python). It scans every text file in the skill for:

- **Credential access** — secret-file paths and private-key blocks (critical)
- **Wallet traps** — any request for a wallet backup words (critical; no legitimate skill needs one)
- **Exfiltration shapes** — the dangerous combinations: environment reads + network calls in one file (critical), file writes + network calls (high)
- **Execution surface** — shell commands, child processes, dynamic code evaluation, HTTP POST channels
- **Single-pattern risks** — environment reads, network calls, file writes/deletes, long base64 blobs, obfuscation hints
- **Network inventory** — every external domain referenced anywhere in the skill

Output is a Markdown report with an **A–F verdict**, per-finding severity, rule id, file and line, plus the domain inventory. Exit code is 1 when a critical finding exists, so it drops into CI.

## Declared behavior of this skill itself

The scanner only **reads** the folder you point it at and writes a report to stdout (or to the single file given with `--out`). It makes **no network calls** and reads **no environment variables**. One transparency note: because this file *is* the scanner, its rulebook necessarily contains the patterns it detects — in this edition the sensitive literals are assembled from fragments so naive text scanners do not flag the rulebook itself; the assembled patterns are exactly the rules listed above, and the plain readable original is public at github.com/kontenlaris-studio/skill-audit.

## Remediation included

This registry edition also ships the bundle's playbooks: `references/fix-guide.md` (a remedy keyed to every rule id above, with verification steps) and `references/hardening.md` (least-privilege structure: split config/transport/logic modules, allowlists, disclosure templates). The full five-skill bundle — with the instruction reviewer and the threat-pattern field guide — lives in the public GitHub repo (kontenlaris-studio/agent-skill-security-bundle).

## Limits

A pattern scan is evidence, not proof of safety. Pair the report with a human read of the skill's SKILL.md: check that every environment variable, domain and write the code performs is disclosed there. Undocumented behavior — not any single pattern — is the strongest danger signal.
