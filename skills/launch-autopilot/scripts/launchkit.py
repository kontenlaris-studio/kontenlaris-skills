#!/usr/bin/env python3
"""launchkit.py — Launch Autopilot: one product -> a complete launch pack.

Input: a facts JSON (the generator assembles; it never invents facts):
  {name, url, tagline, what, problem, audience, stack, proof, maker}

Output folder:
  producthunt.md  name/tagline/description/first comment/topics/asset list
  devhunt.md      the technical-angle version
  showhn.md       Show HN title + post in HN voice
  social.md       X post + Telegram channel post
  checklist.md    assets & accounts to have ready
  schedule.md     T-1 / launch day / T+1 timeline

Rules enforced: Product Hunt tagline <= 60 chars (auto-trimmed with a
warning), Show HN title in "Show HN: X – what it does" form.
Usage: python3 launchkit.py facts.json --out pack/
"""
import argparse, json, os, sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("facts")
    ap.add_argument("--out", default="launch-pack")
    a = ap.parse_args()
    f = json.load(open(a.facts))
    for k in ["name", "url", "tagline", "what", "problem", "audience"]:
        if not f.get(k):
            print(f"facts missing: {k}", file=sys.stderr)
            return 1
    name, url = f["name"], f["url"]
    tagline = f["tagline"]
    warn = ""
    if len(tagline) > 60:
        tagline = tagline[:57].rstrip() + "…"
        warn = f"\n> ⚠️ Tagline auto-trimmed to 60 chars for Product Hunt: check it still reads well.\n"
    os.makedirs(a.out, exist_ok=True)
    W = lambda n, s: open(os.path.join(a.out, n), "w").write(s)  # noqa: E731

    W("producthunt.md", f"""# Product Hunt — {name}
{warn}
**Name:** {name}
**Tagline ({len(tagline)}/60):** {tagline}
**URL:** {url}
**Topics:** Productivity, Invoicing, Small Business, Open Source

## Description
{f['what']}

Built for {f['audience']}. The problem: {f['problem']}

{f.get('proof','')}

## First comment (post immediately at launch)
Hi Product Hunt 👋 I built {name} because {f['problem']}

{f['what']}

It's live and free to use right now: {url}
I'd genuinely love your feedback — what would make this your default tool? I'll be here all day answering everything.
""")
    W("devhunt.md", f"""# DevHunt — {name}

**{name} — {tagline}**

{url}

## The engineering angle
Stack: {f.get('stack','—')}

{f['what']}

Why builders might care: {f.get('proof','')}
""")
    hn_title = f"Show HN: {name} – {f['tagline'].split('—')[0].strip().lower()}"
    W("showhn.md", f"""# Hacker News — Show HN

**Title:** {hn_title}
**URL:** {url}

## Post text (HN voice: plain, technical, no marketing)
I built {name}. {f['what']}

Motivation: {f['problem']}

Stack: {f.get('stack','—')}. {f.get('proof','')}

Feedback welcome — especially on what's missing before you'd switch to it.
""")
    W("social.md", f"""# Social posts — {name}

## X (launch morning)
🚀 Launching {name} today

{tagline}

{f['problem'].capitalize()} — so I built the fix. Free, live now 👇
{url}

Live on Product Hunt today — link in reply. Feedback = fuel. 🙏

## Telegram channel
🚀 **Launch day — {name}**

{tagline}

{f['what']}

Live now: {url}
Today it launches on Product Hunt — if you try it, tell me what broke. Numbers posted here tonight, good or bad.
""")
    W("checklist.md", f"""# Launch checklist — {name}

- [ ] Logo 240×240 PNG ready
- [ ] Gallery: 3–5 screenshots at 1270×760 (real UI, no mockups)
- [ ] 30s demo GIF or video (record the happy path)
- [ ] Product Hunt account aged & profile complete (avatar, bio, maker link)
- [ ] DevHunt + HN accounts ready (HN: never ask for upvotes — bannable)
- [ ] Landing page checked on mobile; the launch URL is the live one: {url}
- [ ] First comment text pasted from producthunt.md (do not improvise)
- [ ] Reply rota: someone answers every comment within 1 hour, 00:01–23:59 PT
- [ ] Analytics open in a tab; baseline noted before launch
- [ ] T+1 retro scheduled (numbers -> channel post)
""")
    W("schedule.md", f"""# Launch schedule — {name} (Product Hunt day, PT times)

**T-1 day**
- Schedule the PH launch for 00:01 PT; gallery + first comment staged
- Warm post on your own channels: "launching tomorrow" (no link yet)
- Sleep early — launch day is a comment marathon

**Launch day**
- 00:01 PT — launch goes live; post the first comment within 5 minutes
- 00:15 PT — X post + Telegram post (social.md), PH link added
- Every hour — reply to every new comment; log objections verbatim
- 12:00 PT — mid-day numbers check; one honest update post
- 23:59 PT — day closes; screenshot the ranking

**T+1**
- Thank-you post with real numbers (rank, upvotes, visits, signups/sales)
- Objections log -> product backlog (top 3 become next tasks)
- Retro note filed with the pack
""")
    print(f"OK launch pack in {a.out}/ (6 files) for {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
