# Fixes by rule id

## crypto_seed_phrase (critical)
**Why it fires:** the skill mentions or requests wallet recovery secrets.
**Fix:** Delete the request entirely. If the skill legitimately interacts with a wallet, integrate through wallet software/APIs that sign without exposing secrets. There is no safe version of asking.
**Verify:** the phrase class appears nowhere — docs, code, examples, comments.

## private_key_block (critical)
**Why:** an embedded private key (test keys included — they train bad habits and scanners can't tell them from real ones).
**Fix:** Remove the key; load keys from the platform vault at runtime. For tests, generate a throwaway key in the test setup, never commit one.
**Verify:** audit clean; repo history rewritten if the key was ever real.

## credential_file_access (critical)
**Why:** the code touches credential stores or secret files.
**Fix:** Stop reading those paths. Use the platform's credential/connector mechanism, which hands the skill an authorized call, not the secret.
**Verify:** no code path references credential locations; SKILL.md declares how credentials are obtained instead.

## composite_env_exfil (critical)
**Why:** one file both reads environment and makes network calls.
**Fix:** Split modules: a config module that reads env and returns plain values; a transport module that receives only the values it needs for one call. If the design truly needs both (an API client), the env read belongs in config, the HTTP in transport, and the SKILL.md must declare the pairing and the single domain involved.
**Verify:** no single file matches both patterns; disclosure names the pairing honestly.

## composite_write_exfil (high)
**Why:** one file writes files and makes network calls.
**Fix:** Separate the writer from the caller; pass data through the logic layer. Declare both capabilities.
**Verify:** as above.

## shell_execution (high)
**Why:** shelling out runs arbitrary command strings.
**Fix:** Replace with library calls; where a subprocess is unavoidable, use a fixed argument array (never string interpolation from user input) and an allowlist of binaries.
**Verify:** no command string is built from untrusted input.

## dynamic_eval (high)
**Why:** evaluating dynamic strings executes unreviewed code.
**Fix:** Replace with explicit dispatch tables/parsers. Configuration is data — parse it, don't run it.
**Verify:** no eval/exec of non-constant strings remains.

## network_post (high)
**Why:** outbound POST is the exfiltration channel.
**Fix:** Name the destination and payload in the disclosure; send the minimum fields; if the POST is telemetry, make it opt-in and say exactly what is sent.
**Verify:** domain appears in the network inventory and in SKILL.md with matching purpose.

## env_access / network_call / file_write (medium)
**Why:** legitimate capabilities that must be accounted for.
**Fix:** Either eliminate, or document precisely (names, domains, paths) in a Declared behavior section. Documentation is the fix when the capability is the point of the skill.
**Verify:** every occurrence is covered by the disclosure — a reader finds no surprises.

## base64_blob / obfuscation (low)
**Why:** hidden payloads hide in encoded blobs.
**Fix:** Decode and commit the readable form, or document what the blob is and its hash. Code should never arrive encoded.
**Verify:** a reviewer can read everything the agent will run.
