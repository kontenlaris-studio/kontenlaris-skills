---
name: fix-guide
description: Fix every SkillAudit finding — a remediation playbook keyed to the scanner's rule ids, with the safe pattern to replace each dangerous one and how to verify the fix.
---

# Fix Guide — from verdict to clean

Run skill-audit, take each finding's rule id, apply the matching fix in `references/FIXES.md`, then re-run the audit and attach the improved report. The rules covered:

- `crypto_seed_phrase`, `private_key_block`, `credential_file_access` (critical) — remove, never relocate
- `composite_env_exfil`, `composite_write_exfil` (critical/high) — restructure, don't rename
- `shell_execution`, `dynamic_eval`, `network_post` (high) — replace with bounded alternatives
- `env_access`, `network_call`, `file_write` (medium) — document or eliminate
- `base64_blob`, `obfuscation` (low) — decode, explain, or drop

A fix that only renames variables or moves code between files in the same module is not a fix — the scanner's combinations are structural, and so are the remedies.
