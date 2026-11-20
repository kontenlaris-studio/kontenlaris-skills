#!/usr/bin/env python3
"""riset.py — last-30-days trend research across keyless public sources.

Sources: Hacker News (Algolia API), GitHub Search API, Google News RSS.
Output: a markdown brief where every item carries its date and source —
grounded by construction, nothing invented.

Usage: python3 riset.py "your topic" [--days 30] [--limit 8]
"""
import argparse, json, re, sys, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

UA = {"User-Agent": "trend-scout/1.0 (+https://github.com/kontenlaris-studio)"}


def get(url, timeout=20):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def hn(topic, days, limit):
    since = int((datetime.now(timezone.utc) - timedelta(days=days)).timestamp())
    q = urllib.parse.quote(topic)
    url = (f"https://hn.algolia.com/api/v1/search?query={q}"
           f"&tags=story&numericFilters=created_at_i>{since}"
           f"&hitsPerPage={limit}")
    data = json.loads(get(url))
    out = []
    for h in data.get("hits", []):
        d = datetime.fromtimestamp(h["created_at_i"], timezone.utc)
        out.append({"date": d.date().isoformat(), "title": h.get("title") or "",
                    "points": h.get("points") or 0,
                    "url": h.get("url") or
                    f"https://news.ycombinator.com/item?id={h['objectID']}"})
    return sorted(out, key=lambda x: x["points"], reverse=True)


def github(topic, days, limit):
    since = (datetime.now(timezone.utc) - timedelta(days=days)).date().isoformat()
    q = urllib.parse.quote(f"{topic} created:>{since}")
    url = f"https://api.github.com/search/repositories?q={q}&sort=stars&order=desc&per_page={limit}"
    data = json.loads(get(url))
    return [{"date": r["created_at"][:10], "title": r["full_name"],
             "stars": r["stargazers_count"],
             "desc": (r.get("description") or "")[:110], "url": r["html_url"]}
            for r in data.get("items", [])]


def gnews(topic, days, limit):
    q = urllib.parse.quote(f"{topic} when:{days}d")
    url = f"https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"
    root = ET.fromstring(get(url))
    out = []
    for item in root.iter("item"):
        title = item.findtext("title") or ""
        link = item.findtext("link") or ""
        pub = item.findtext("pubDate") or ""
        try:
            d = datetime.strptime(pub[:16], "%a, %d %b %Y").date().isoformat()
        except ValueError:
            d = pub[:16]
        out.append({"date": d, "title": title, "url": link})
        if len(out) >= limit:
            break
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("topic")
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--limit", type=int, default=8)
    a = ap.parse_args()
    today = datetime.now(timezone.utc).date().isoformat()
    print(f"# Trend brief: {a.topic} — last {a.days} days (generated {today})\n")
    sections = []
    try:
        sections.append(("Hacker News (by points)", hn(a.topic, a.days, a.limit),
                         lambda x: f"- [{x['date']}] {x['title']} "
                                   f"({x['points']} pts) — {x['url']}"))
    except Exception as e:  # noqa: BLE001
        print(f"> Hacker News unavailable: {e}\n")
    try:
        sections.append(("GitHub — new repos by stars",
                         github(a.topic, a.days, a.limit),
                         lambda x: f"- [{x['date']}] {x['title']} "
                                   f"(★{x['stars']}) {x['desc']} — {x['url']}"))
    except Exception as e:  # noqa: BLE001
        print(f"> GitHub unavailable: {e}\n")
    try:
        sections.append(("Google News", gnews(a.topic, a.days, a.limit),
                         lambda x: f"- [{x['date']}] {x['title']} — {x['url']}"))
    except Exception as e:  # noqa: BLE001
        print(f"> Google News unavailable: {e}\n")
    for name, items, fmt in sections:
        print(f"## {name}")
        if not items:
            print("- (no results in window)")
        for x in items:
            print(fmt(x))
        print()
    print("> Every line above came from a live source with its date; "
          "treat titles as claims to verify, not facts.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
