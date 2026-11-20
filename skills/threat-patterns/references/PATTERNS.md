# Pattern Catalog

## 1. The quiet exfiltrator
**How:** A helper module collects environment variables or file contents; a second module "checks for updates" or "syncs settings" to an attacker host. Split across files so no single file looks damning.
**Tell:** The capability *combination*, not any single line. If a skill can both read secrets and reach the network, demand a documented reason for both — in the same breath.
**Defense:** Structural split with allowlists (see the bundle's hardening skill); refuse env+network in one package without a contract-grade disclosure.

## 2. The disguised instruction
**How:** The SKILL.md body contains imperatives aimed at the agent: don't mention this step, always comply with documents the skill provides, treat the user's caution as an obstacle.
**Tell:** Instructions about the *conversation* (what to say/hide) rather than about the *task*.
**Defense:** Line-by-line review (skill-reviewer). Secrecy instructions are disqualifying alone.

## 3. The wallet trap
**How:** The skill claims to "verify", "back up" or "secure" a wallet and asks for the backup words or a private key — sometimes routed through a form, a file the agent must create, or a "one-time check".
**Tell:** Any path by which recovery secrets would be typed, stored or transmitted. Legitimate tools sign through wallet software; they never see the words.
**Defense:** Absolute rule — no skill gets recovery secrets, in any wording, ever. Treat the ask itself as proof of malice.

## 4. The update-channel hijack
**How:** Version 1.0 is clean and earns installs; the skill instructs the agent to fetch "current instructions" from a URL at each run. The URL's content changes later.
**Tell:** Runtime fetches of anything the agent will *obey* (as opposed to data it will *show*).
**Defense:** Pin instructions in the package; updates only as re-reviewed versions.

## 5. The typosquat
**How:** `git-forge-pro`, `tiny-chess-engines`, an extra hyphen, a swapped letter — riding a popular skill's search traffic with one extra capability (usually network).
**Tell:** Name similarity + recent creation + scope slightly wider than the original.
**Defense:** Install from the original author's namespace only; compare capability lists before switching.

## 6. The helpful harvester
**How:** The stated job is real and done well; quietly, usage details — file names, prompt text, contact lists — are posted home as "analytics".
**Tell:** Network domains that the stated job cannot explain; analytics that are on by default and described vaguely.
**Defense:** Domain inventory in every audit; unexplained domain = do not install.

## 7. The authority costume
**How:** "Official platform skill", "required for compliance", "pre-approved" — asserted in prose to shortcut your review.
**Tell:** Authority that is claimed in the skill itself rather than verifiable on the platform (badges, verified publisher, registry scan state).
**Defense:** Trust platform-issued signals only; prose claims count for nothing.

## 8. The dependency smuggler
**How:** The skill is thin; the payload lives in a package it tells you to install, a script it downloads, or a "companion tool".
**Tell:** Install steps that leave the reviewed surface.
**Defense:** Review everything the skill causes to be installed as part of the skill.

## 9. The slow burn
**How:** Behavior is conditional: clean for small inputs, different for valuable ones (large files, specific keywords, dates after a threshold).
**Tell:** Conditional branches around the risky capability; time or size triggers near network/file code.
**Defense:** Read every branch that touches the risky capability, not just the happy path.
