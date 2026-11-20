#!/usr/bin/env python3
"""prescreen.py — mechanical pre-screen for a product page.

Checks the signals real buyers (and the persona panel) look for, so the
panel's objections cite facts, not vibes. Deterministic, offline.

Usage: python3 prescreen.py page.txt [--price 249000]
Output: markdown checklist with PASS/MISSING per signal + a 0-100 base
score the panel starts from.
"""
import argparse, re, sys

SIGNALS = [
    ("price_visible", "Price is stated",
     r"(rp\s?[\d.]+|\$\s?\d|idr\s?[\d.]+|price|harga)"),
    ("what_you_get", "A concrete 'what you get' list",
     r"(you get|you'll get|isi|termasuk|includes|dapat(kan)?\s|berisi)"),
    ("who_for", "Who this is for (and not for)",
     r"(for (you|creators|business|umkm|pemula)|untuk (kamu|pemula|umkm|toko)|cocok untuk|not for|bukan untuk)"),
    ("guarantee", "Guarantee / refund / risk reversal",
     r"(garansi|guarantee|refund|uang kembali|money-back|money back)"),
    ("proof", "Proof: results, numbers, examples, screenshots",
     r"(terverifikasi|verified|tested|teruji|contoh hasil|example|demo|ribu|testimoni|review)"),
    ("how_it_works", "How it works / delivery explained",
     r"(cara (kerja|pakai|order)|how it works|dikirim|delivery|download|unduh|langsung (dapat|akses))"),
    ("faq", "Objection handling (FAQ or limits stated honestly)",
     r"(faq|sering ditanya|pertanyaan|batas|limits|catatan|note:)"),
    ("cta", "One clear call to action",
     r"(beli|buy|order|checkout|dapatkan|get it|mulai sekarang)"),
    ("contact", "A reachable human (email/support)",
     r"(gmail|@|whatsapp|wa\.me|support|hubungi|kontak)"),
    ("specificity", "Specific numbers (not just adjectives)",
     r"\d+\s?(file|workflow|template|halaman|bab|video|menit|hari|%|x\b)"),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    a = ap.parse_args()
    text = open(a.file).read()
    low = text.lower()
    words = len(text.split())
    got, lines = 0, []
    for key, label, pat in SIGNALS:
        hit = re.search(pat, low) is not None
        got += hit
        lines.append(f"- [{'x' if hit else ' '}] {label}")
    score = round(got / len(SIGNALS) * 100)
    print("# Pre-screen — mechanical buyer signals")
    print(f"Page length: {words} words")
    print("\n".join(lines))
    print(f"\n## Base score: {score}/100 ({got}/{len(SIGNALS)} signals present)")
    if words < 60:
        print("Warning: page is very short — most personas bounce on thin pages.")
    if words > 900:
        print("Warning: page is long — the busy-buyer persona will skim or bounce.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
