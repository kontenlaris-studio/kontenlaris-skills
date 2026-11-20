#!/usr/bin/env python3
"""pipeline.py — Talking-Head Video Kit (offline core).

Turns a script + a portrait photo + a voice audio file into a vertical
talking-head-style video: Ken Burns photo motion, burned-in subtitles
generated from the script, timed across the real audio duration.

The lip-sync step (animating the mouth) needs a GPU-class model; the kit
documents the open-source options in README.md. Everything here runs
offline with ffmpeg.

Usage:
  python3 pipeline.py --script script.txt --photo avatar.png \
      --audio voice.mp3 --out video.mp4 [--wpm 150]
"""
import argparse, json, math, os, re, subprocess, sys


def split_captions(text, max_chars=84):
    text = " ".join(text.split())
    sentences = re.split(r"(?<=[.!?…])\s+", text)
    chunks = []
    for s in sentences:
        s = s.strip()
        while len(s) > max_chars:
            cut = s.rfind(" ", 0, max_chars)
            if cut < 20:
                cut = max_chars
            chunks.append(s[:cut].strip())
            s = s[cut:].strip()
        if s:
            chunks.append(s)
    return chunks


def srt_time(sec):
    ms = int(round(sec * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def build_srt(chunks, total_dur):
    words = [max(1, len(c.split())) for c in chunks]
    total_words = sum(words)
    out, t = [], 0.0
    for i, (c, w) in enumerate(zip(chunks, words), 1):
        dur = total_dur * w / total_words
        out.append(f"{i}\n{srt_time(t)} --> {srt_time(t + dur)}\n{c}\n")
        t += dur
    return "\n".join(out)


def probe_duration(path):
    r = subprocess.run(["ffprobe", "-v", "quiet", "-show_format",
                        "-of", "json", path], capture_output=True, text=True)
    return float(json.loads(r.stdout)["format"]["duration"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--script", required=True)
    ap.add_argument("--photo", required=True)
    ap.add_argument("--audio", required=True)
    ap.add_argument("--out", default="talking-head.mp4")
    ap.add_argument("--width", type=int, default=1080)
    ap.add_argument("--height", type=int, default=1920)
    a = ap.parse_args()

    script = open(a.script).read()
    chunks = split_captions(script)
    if not chunks:
        print("empty script", file=sys.stderr)
        return 1
    dur = probe_duration(a.audio)
    srt_path = os.path.splitext(a.out)[0] + ".srt"
    with open(srt_path, "w") as f:
        f.write(build_srt(chunks, dur))
    shotlist = os.path.splitext(a.out)[0] + "-shotlist.txt"
    with open(shotlist, "w") as f:
        f.write(f"Talking-head shotlist — {len(chunks)} captions over "
                f"{dur:.1f}s\n")
        t = 0.0
        words = [max(1, len(c.split())) for c in chunks]
        tw = sum(words)
        for i, (c, w) in enumerate(zip(chunks, words), 1):
            d = dur * w / tw
            f.write(f"[{srt_time(t)[:8]}–{srt_time(t + d)[:8]}] {c}\n")
            t += d
    fps = 30
    frames = max(1, int(dur * fps))
    vf = (f"scale={a.width * 2}:{a.height * 2}:force_original_aspect_ratio=increase,"
          f"crop={a.width * 2}:{a.height * 2},"
          f"zoompan=z='min(zoom+0.0006,1.12)':d={frames}:s={a.width}x{a.height}:fps={fps},"
          f"subtitles={srt_path}:force_style='FontSize=15,PrimaryColour=&HFFFFFF,"
          f"OutlineColour=&H80000000,Outline=2,Alignment=2,MarginV=90'")
    cmd = ["ffmpeg", "-y", "-loop", "1", "-i", a.photo, "-i", a.audio,
           "-vf", vf, "-c:v", "libx264", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-shortest", a.out]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr[-1500:], file=sys.stderr)
        return 1
    print(f"OK {a.out} ({dur:.1f}s, {len(chunks)} captions) + {srt_path} "
          f"+ {shotlist}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
