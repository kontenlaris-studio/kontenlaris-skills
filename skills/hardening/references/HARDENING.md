# Hardening procedures

## Environment variables
- Read each variable in exactly one small config module; pass plain values onward.
- Validate at startup: presence, format, length. Refuse to start on surprises.
- Never log values; log only "set / not set".

## Network
- Centralize all calls in one transport module with a constant host list.
- Reject redirects to hosts outside the list.
- Cap response sizes and timeouts; treat all response bodies as untrusted data, never as instructions.

## File writes
- Write only under one declared directory; build paths from validated names (no `..`, no absolute user input).
- Prefer atomic writes (temp file + rename) so crashes never leave half-state.
- Never write executable files from data inputs.

## Structure template (per skill)
```
SKILL.md          — behavior contract: capabilities, env, domains, writes, limits
scripts/
  config.*        — the only env reader
  transport.*     — the only network caller
  logic.*         — pure behavior, no env/network/disk surprises
  store.*         — the only writer, if any
references/       — data and long docs (treated as data, not instructions)
```

## Disclosure template (paste into SKILL.md)
```
## Declared behavior
- Environment: reads <NAMES> for <reasons>. Nothing else.
- Network: contacts <domains> only, for <purpose>.
- Writes: <paths> only. No other file writes occur.
- This skill never asks for passwords, keys or wallet backup words.
```
