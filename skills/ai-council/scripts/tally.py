#!/usr/bin/env python3
"""tally.py — count an AI Council session's votes, deterministically.

Session file format (markdown):
  ## Investor — GO | GO_WITH_CONDITIONS | NO_GO
  conditions: - measurable condition (one per line, under the seat)

Usage: python3 tally.py session.md
Verdict: majority GO -> GO; any NO_GO majority -> NO_GO; otherwise
GO_WITH_CONDITIONS with every seat's conditions merged, deduplicated.
"""
import re, sys
from collections import Counter

SEATS = ["Investor", "Customer", "Engineer", "Risk Counsel", "Skeptic"]


def main():
    text = open(sys.argv[1]).read()
    votes, conds = {}, []
    blocks = re.split(r"^## ", text, flags=re.M)[1:]
    for b in blocks:
        head, _, body = b.partition("\n")
        seat = next((s for s in SEATS if head.strip().lower().startswith(s.lower())), None)
        if not seat:
            continue
        m = re.search(r"GO_WITH_CONDITIONS|NO_GO|\bGO\b", head)
        if m:
            votes[seat] = m.group(0)
        for line in body.splitlines():
            ls = line.strip()
            if ls.startswith("- ") and "conditions" not in ls.lower():
                conds.append(ls[2:].strip())
    if not votes:
        print("No seat votes found — check the session format.")
        return 1
    c = Counter(votes.values())
    print("# Council tally")
    for s in SEATS:
        if s in votes:
            print(f"- {s}: {votes[s]}")
    if c.get("NO_GO", 0) >= 3:
        verdict = "NO_GO"
    elif c.get("GO", 0) >= 3:
        verdict = "GO"
    else:
        verdict = "GO_WITH_CONDITIONS"
    seen, merged = set(), []
    for x in conds:
        k = x.lower()
        if k not in seen:
            seen.add(k); merged.append(x)
    print(f"\n## Verdict: {verdict} ({dict(c)})")
    if merged and verdict != "NO_GO":
        print("\nConditions:")
        for x in merged:
            print(f"- {x}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
