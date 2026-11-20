---
name: talking-head-kit
description: Produce vertical talking-head videos from a script, one portrait photo and a voice track — caption splitting, word-timed subtitles, shot lists and an offline ffmpeg render pipeline.
---

# Talking-Head Kit — faceless video production

The bottleneck for faceless channels was never ideas; it was appearing on camera. This skill is the production system that removes the camera: script → captions → timed subtitles → vertical video.

## The pipeline

```
python3 scripts/pipeline.py --script script.txt --photo avatar.png --audio voice.mp3 --out video.mp4
```

- Pure Python 3 + ffmpeg, fully offline. The photo is scaled to 1080×1920 with a slow Ken Burns zoom.
- Captions are split from the script at sentence/clause boundaries (≤ ~84 chars), timed by word count across the **real** audio duration (read via ffprobe), written as a sidecar `.srt`, and burned into the video.
- A `-shotlist.txt` with per-caption time windows is written next to the output.
- Verified end-to-end: renders a valid 1080×1920 MP4 whose caption timings match the word-proportional schedule.

## Script rules that make it work

1. One idea per sentence; short sentences caption cleanly.
2. Front-load the hook in the first sentence — it is also your first caption and your thumbnail text.
3. Write numbers as words if you want them spoken that way by TTS ("eighty-three percent").
4. Target 130–160 words per minute of finished video when estimating length.

## Voice options

Record yourself (the hosted app includes a teleprompter workflow), bring any TTS output, or use a produced voice. The pipeline is voice-agnostic: any audio file works, because caption timing derives from the audio's actual duration, not from estimates.

## Honest limits — lip-sync

The pipeline animates the frame (motion, captions, pacing), not the mouth. True lip-sync requires a GPU-class model; pair the photo with SadTalker or Wav2Lip first if you need it, then finish (captions + vertical format) with this pipeline. Scripting, subtitling and finishing are most of the production work either way.

## Declared behavior

- Environment: reads nothing.
- Network: contacts nothing — the pipeline is fully offline.
- Writes: only the output video, its `.srt` sidecar and its shotlist, at the paths given via `--out`.
- Local execution: invokes `ffmpeg`/`ffprobe` as fixed argument arrays (no shell, no interpolated command strings) on the files the user names.
- This skill never asks for passwords, keys or wallet backup words.
