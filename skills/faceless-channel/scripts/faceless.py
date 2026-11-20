#!/usr/bin/env python3
"""faceless.py — Faceless Channel Automation Pack (deterministic orchestrator).

Chains the Kontenlaris Studio modules into one faceless-channel workflow:

  Trend Scout (topics) -> Story-to-Shorts (scripts) -> Talking-Head Kit
  (render) -> ClipSmith (captions/clips) -> Launch Autopilot (schedule)

Input is a niche keyword (built-in topic banks) or a topics JSON file:
  [{"topic": "...", "angle": "history", "facts": ["...", "..."]}, ...]

Output folder (a complete 30-day channel pack):
  calendar.csv / calendar.md   30-day content calendar
  scripts/day-XX-<slug>/       script.txt (Talking-Head pipeline format)
                               + pack.md (timed scenes, title, hashtags)
  schedule.md                  posting schedule per platform
  checklist.md                 per-video + channel-launch checklists
  channel-setup.md             name / banner / description templates
                               for all 5 built-in niches
  pack-summary.md              what was generated, counts, next steps

The script assembler replicates the Story-to-Shorts studio.py framework
exactly (same hooks, turn, close and script.txt format), so every script
feeds the Talking-Head Kit pipeline unchanged.

Usage:
  python3 faceless.py --niche history --out pack/
  python3 faceless.py --topics topics.json --out pack/ --per-week 5
  python3 faceless.py --selftest
Angles: mistake | history | myth | numbers | story
Niches: finance | history | health | tech | motivation
"""
import argparse, csv, datetime, io, json, os, re, sys, tempfile

# --- Story-to-Shorts assembler (replicated verbatim in behaviour) --------
HOOKS = {
    "mistake": "Stop. You're making the one mistake that kills {topic_low} — and it's not what you think.",
    "history": "In the beginning, {topic} was completely different. Then one change rewrote everything.",
    "myth": "Everything you believe about {topic} is wrong. Here is the proof.",
    "numbers": "The numbers behind {topic} make no sense — until you see this one.",
    "story": "This is the story of {topic} — and it does not end the way you expect.",
}
TURN = "But here is where it gets interesting."
CLOSE = "Agree or not? Tell me in the comments — and follow for part two."
ANGLES = list(HOOKS)

WEEKDAY_SETS = {  # videos-per-week -> weekday numbers (Mon=0)
    7: [0, 1, 2, 3, 4, 5, 6], 6: [0, 1, 2, 3, 4, 5], 5: [0, 1, 2, 3, 4],
    4: [0, 1, 3, 5], 3: [0, 2, 4], 2: [1, 5], 1: [6],
}
POST_TIMES = {"youtube": "12:00", "tiktok": "19:00", "both": "12:00 YT · 19:00 TikTok"}


def assemble(topic, angle, facts):
    """Same framework as studio.py: hook, facts, mid turn, close."""
    topic_low = topic[0].lower() + topic[1:]
    hook = HOOKS[angle].format(topic=topic, topic_low=topic_low)
    mid = max(1, len(facts) // 2)
    sentences = [hook] + facts[:mid] + [TURN] + facts[mid:] + [CLOSE]
    script = " ".join(sentences)
    return script, sentences, hook


def slugify(text):
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s[:40] or "video"


def write_video_pack(out_dir, topic, angle, facts):
    script, sentences, hook = assemble(topic, angle, facts)
    words = len(script.split())
    secs = round(words / 150 * 60)
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "script.txt"), "w") as f:
        f.write(script + "\n")
    notes = {hook: "HOOK — big text overlay, face/photo zoom-in",
             TURN: "TURN — pattern interrupt: cut, zoom or angle change",
             CLOSE: "CLOSE — comment prompt on screen"}
    with open(os.path.join(out_dir, "pack.md"), "w") as f:
        f.write(f"# Story-to-Shorts pack — {topic}\n\n")
        f.write(f"Angle: {angle} · ~{words} words · ~{secs}s at 150 wpm\n\n")
        f.write("## Script (feed this to the Talking-Head pipeline)\n\n")
        f.write(script + "\n\n## Scene list\n\n")
        t = 0.0
        for s in sentences:
            d = len(s.split()) / 150 * 60
            f.write(f"- [{t:05.1f}s–{t + d:05.1f}s] "
                    f"{notes.get(s, 'B-roll / supporting visual for this line')}\n  > {s}\n")
            t += d
        f.write("\n## Title & hashtags\n\n")
        f.write(f"{topic} — the part nobody tells you\n")
        tags = " ".join("#" + w for w in ["shorts", "storytime"] +
                        [x.lower().replace(" ", "") for x in
                         topic.replace("—", " ").split()[:2]])
        f.write(tags + "\n")
    return words, secs


# --- Built-in niche banks ---------------------------------------------------
def T(topic, *facts):
    return {"topic": topic, "facts": list(facts)}


NICHES = {
    "history": {
        "label": "History facts",
        "names": ["Forgotten Minutes", "History in 60", "The Past Tapes"],
        "banner": "One true story from history — every day, in 60 seconds",
        "hashtags": "#history #historyfacts #shorts",
        "topics": [
            T("Cleopatra and the pyramids",
              "Cleopatra was the last active pharaoh of Egypt.",
              "She spoke nine languages, including Egyptian — the first Ptolemy ruler who bothered to learn it.",
              "The Great Pyramid was already about 2,500 years old when she was born.",
              "That means Cleopatra lived closer in time to the smartphone than to the building of the pyramids."),
            T("The Great Wall of China",
              "The wall was not built by one emperor — dynasties added sections over roughly two thousand years.",
              "A 2012 survey measured all sections together at 21,196 kilometres.",
              "Workers in the Ming dynasty used sticky rice mortar that still holds bricks today.",
              "And no, it cannot be seen from the Moon with the naked eye — that part is a myth."),
            T("The Library of Alexandria",
              "The library was part of a larger research institute called the Mouseion.",
              "Eratosthenes worked there and measured the Earth's circumference with surprising accuracy.",
              "It was not destroyed in one single fire — it declined over centuries of budget cuts and purges.",
              "Its real loss was a network: scholars, copies and the habit of checking facts."),
            T("The first marathon",
              "The legend says Pheidippides ran from Marathon to Athens to announce a victory, then died.",
              "The first modern Olympic marathon was held in Athens in 1896.",
              "The famous 26.2 mile distance was standardised at the London Games of 1908.",
              "It became the official standard for all marathons in 1921."),
            T("Vikings and their helmets",
              "No Viking helmet with horns has ever been found by archaeologists.",
              "The horned image comes from 19th-century opera costumes.",
              "Vikings reached North America around the year 1000, at L'Anse aux Meadows in Canada.",
              "The Bluetooth wireless standard is named after the Viking-age king Harald Bluetooth."),
            T("The printing press",
              "Movable type existed in China centuries before Europe — Bi Sheng made clay type in the 1040s.",
              "The Korean book Jikji was printed with metal type in 1377.",
              "Gutenberg's press around 1440 combined metal type, oil ink and a screw press.",
              "Within decades, Europe's book output went from thousands of copies to millions."),
            T("Pompeii",
              "Mount Vesuvius erupted in 79 CE and buried Pompeii under metres of ash.",
              "The ash preserved buildings, food and even graffiti on the walls.",
              "In 1863, Giuseppe Fiorelli poured plaster into voids in the ash to cast the victims' shapes.",
              "The city was effectively lost for about 1,700 years before systematic excavation."),
            T("The Roman calendar",
              "The early Roman year began in March, which is why September sounds like month seven.",
              "July is named after Julius Caesar and August after Augustus.",
              "Caesar's reform in 45 BCE introduced the leap year.",
              "When the Gregorian calendar replaced it in 1582, ten days were skipped overnight."),
            T("The journey of coffee",
              "Coffee drinking traces back to Ethiopia and the coffee forests of Kaffa.",
              "By the 15th century it was cultivated in Yemen and traded through the port of Mocha.",
              "Coffee houses spread across the Ottoman world before reaching Venice and Vienna.",
              "The first espresso machine was patented in Turin, Italy, in 1901."),
            T("The Eiffel Tower",
              "The tower was built as the entrance arch for the 1889 World's Fair in Paris.",
              "It was only meant to stand for twenty years.",
              "At 330 metres it stayed the world's tallest structure until 1930.",
              "It is repainted about every seven years, using roughly sixty tonnes of paint."),
            T("The ancient Olympics",
              "The first recorded Olympic Games were held in 776 BCE.",
              "For the first editions there was only one event: a sprint of about 192 metres.",
              "Athletes competed nude, and wars paused under an Olympic truce.",
              "The games ran for nearly twelve centuries before being banned in 393 CE."),
            T("The Great Emu War",
              "In 1932, around 20,000 emus damaged wheat crops in Western Australia.",
              "Farmers who were also veterans asked for military help.",
              "Soldiers with machine guns were deployed against the birds in November 1932.",
              "The emus outran and out-scattered the operation — and the military withdrew."),
        ],
    },
    "finance": {
        "label": "Finance facts",
        "names": ["Ledger Lines", "Money in Minutes", "The Quiet Ledger"],
        "banner": "One money concept a day — explained in 60 seconds, no jargon",
        "hashtags": "#personalfinance #moneytips #shorts",
        "topics": [
            T("Compound interest",
              "Interest earns interest on itself, so growth speeds up over time.",
              "Starting ten years earlier can matter more than doubling the amount.",
              "The rule of 72 estimates doubling time: divide 72 by the yearly rate."),
            T("The emergency fund",
              "An emergency fund covers three to six months of essential expenses.",
              "It exists so a broken phone never becomes credit-card debt.",
              "It belongs somewhere boring and reachable, not invested."),
            T("Inflation, explained simply",
              "Inflation means money slowly buys less over time.",
              "Cash under a mattress loses value even though the number never changes.",
              "That is why long-term savings are usually invested, not stored."),
            T("Index funds",
              "An index fund buys a whole market basket in one product.",
              "Fees are low because no one is paid to pick winners.",
              "Most professional stock-pickers underperform the index over long periods."),
            T("The sunk cost trap",
              "Money already spent cannot be recovered by spending more.",
              "People keep bad projects alive to justify the first payment.",
              "Decide from today forward, not from what you already paid."),
            T("Paying yourself first",
              "Saving works better when it leaves your account on payday, automatically.",
              "What remains becomes the spending budget by default.",
              "It flips the usual order: save first, spend the rest."),
        ],
    },
    "health": {
        "label": "Health myths",
        "names": ["Myth or Body", "The Check-Up", "Fact Dose Daily"],
        "banner": "One health myth checked against the evidence — daily",
        "hashtags": "#healthmyths #wellness #shorts",
        "topics": [
            T("The ten percent brain myth",
              "Brain scans show virtually all parts of the brain are active over a day.",
              "Damage to almost any area has noticeable effects.",
              "The myth survives because it promises hidden superpowers."),
            T("Cracking your knuckles",
              "The pop is gas bubbles collapsing in joint fluid.",
              "Large studies find no link between knuckle cracking and arthritis.",
              "Swelling or pain is a different story — that deserves a check-up."),
            T("The eight glasses rule",
              "The eight-glasses figure has no single scientific study behind it.",
              "Thirst is a reliable guide for most healthy adults.",
              "Food and other drinks count toward daily water intake."),
            T("Carrots and night vision",
              "Carrots contain vitamin A, which eyes do need.",
              "But eating extra does not grant night vision.",
              "The story was amplified by wartime propaganda to hide radar technology."),
            T("The five-second rule",
              "Bacteria transfer to dropped food almost instantly.",
              "Wet food picks up more bacteria than dry food.",
              "The floor's cleanliness matters more than the seconds."),
            T("Detox diets",
              "Your liver and kidneys filter waste continuously.",
              "No juice cleanse has been shown to remove named toxins.",
              "What helps is sleep, water and not overloading the system."),
        ],
    },
    "tech": {
        "label": "Tech stories",
        "names": ["First Draft Tech", "How It Started", "The Backstory Bit"],
        "banner": "The surprising backstory of the tech you use every day",
        "hashtags": "#techhistory #technology #shorts",
        "topics": [
            T("The first computer bug",
              "In 1947 a moth was found inside Harvard's Mark II computer.",
              "The team taped it into the logbook, calling it the first actual bug.",
              "The terms bug and debugging were older — the moth made them literal."),
            T("The QWERTY layout",
              "QWERTY was designed in the 1870s for typewriters.",
              "Separating common letter pairs reduced mechanical jams.",
              "We still type on a layout built for machines that no longer exist."),
            T("The first website",
              "The first website went live in 1991 at CERN.",
              "It explained what the web was and how to make a website.",
              "Its address, info.cern.ch, still works today."),
            T("The first programmer",
              "Ada Lovelace wrote an algorithm for Babbage's Analytical Engine in the 1840s.",
              "The machine was never built in her lifetime.",
              "Her notes are still recognised as the first published computer program."),
            T("GPS going public",
              "GPS was built by the US military and launched from 1978.",
              "Civilian access was deliberately degraded until the year 2000.",
              "Switching off the degradation made phone navigation practical."),
            T("The computer mouse",
              "Douglas Engelbart demonstrated the mouse publicly in 1968.",
              "The demo also showed windows, hyperlinks and video calls.",
              "It is still called the Mother of All Demos."),
        ],
    },
    "motivation": {
        "label": "Motivation",
        "names": ["One Percent Daily", "The Small Step", "Quiet Momentum"],
        "banner": "One small, proven idea for getting better — every day",
        "hashtags": "#motivation #habits #shorts",
        "topics": [
            T("The one percent rule",
              "Improving one percent a day compounds to about thirty-seven times in a year.",
              "The math is an illustration, but the direction is real.",
              "Small wins repeat; heroic efforts rarely do."),
            T("The two-minute rule",
              "Shrink a new habit until it takes two minutes or less.",
              "Read one page. Put on the running shoes. Open the document.",
              "Starting is the habit; scale comes after consistency."),
            T("Habit stacking",
              "Attach a new habit to one you already never skip.",
              "After I pour coffee, I will write one sentence.",
              "The existing habit becomes the reminder the new one lacks."),
            T("Environment beats willpower",
              "People who look disciplined usually design their surroundings.",
              "Visible tools get used; hidden friction wins.",
              "Change the room before you blame yourself."),
            T("The five-minute start",
              "Promise only five minutes of the task you avoid.",
              "Starting lowers the brain's threat response to the task.",
              "Most sessions continue past five minutes on their own."),
            T("Tracking streaks",
              "A visible streak turns progress into something you protect.",
              "Mark the day, not the quality of the day.",
              "Never miss twice is the rule that keeps streaks alive."),
        ],
    },
}


NICHE_ORDER = ["finance", "history", "health", "tech", "motivation"]
NICHE_ALIASES = {"finance facts": "finance", "history facts": "history",
                 "health myths": "health", "health": "health",
                 "tech": "tech", "technology": "tech",
                 "motivation": "motivation", "finance": "finance",
                 "history": "history"}


def load_topics(args):
    if args.topics:
        data = json.load(open(args.topics))
        items = [{"topic": d["topic"], "facts": list(d["facts"]),
                  "angle": d.get("angle")} for d in data]
        niche = NICHE_ALIASES.get((args.niche or "").lower(), "history")
        return items, niche
    niche = NICHE_ALIASES.get((args.niche or "history").lower())
    if niche is None:
        raise SystemExit(f"unknown niche: {args.niche} "
                         f"(choose from {', '.join(NICHE_ORDER)})")
    bank = NICHES[niche]["topics"]
    return [{"topic": t["topic"], "facts": list(t["facts"]), "angle": None}
            for t in bank], niche


def build_pack(args):
    items, niche = load_topics(args)
    meta = NICHES[niche]
    start = datetime.date.fromisoformat(args.start)
    days = [start + datetime.timedelta(days=i) for i in range(30)]
    weekdays = WEEKDAY_SETS[args.per_week]
    post_days = [d for d in days if d.weekday() in weekdays]
    if not post_days:
        raise SystemExit("no posting days in window — check --per-week")
    os.makedirs(args.out, exist_ok=True)
    scripts_dir = os.path.join(args.out, "scripts")
    os.makedirs(scripts_dir, exist_ok=True)

    rows = []
    for i, day in enumerate(post_days):
        item = items[i % len(items)]
        angle = item["angle"] or ANGLES[i % len(ANGLES)]
        folder = f"day-{i + 1:02d}-{slugify(item['topic'])}"
        words, secs = write_video_pack(os.path.join(scripts_dir, folder),
                                       item["topic"], angle, item["facts"])
        rows.append({"n": i + 1, "date": day.isoformat(),
                     "weekday": day.strftime("%a"), "topic": item["topic"],
                     "angle": angle, "folder": folder, "words": words,
                     "secs": secs})

    # calendar.csv
    with open(os.path.join(args.out, "calendar.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["day", "date", "weekday", "topic", "angle",
                    "script_folder", "youtube_time", "tiktok_time", "status"])
        for r in rows:
            w.writerow([r["n"], r["date"], r["weekday"], r["topic"], r["angle"],
                        f"scripts/{r['folder']}", POST_TIMES["youtube"],
                        POST_TIMES["tiktok"], "planned"])
    # calendar.md
    with open(os.path.join(args.out, "calendar.md"), "w") as f:
        f.write(f"# 30-day content calendar — {meta['label']}\n\n")
        f.write(f"Start: {start.isoformat()} · Cadence: {args.per_week}/week · "
                f"Videos planned: {len(rows)} · Platform: {args.platform}\n\n")
        f.write("| Day | Date | Topic | Angle | Script |\n|---|---|---|---|---|\n")
        for r in rows:
            f.write(f"| {r['n']} | {r['date']} ({r['weekday']}) | {r['topic']} "
                    f"| {r['angle']} | scripts/{r['folder']}/ |\n")
        f.write("\nTopics come from Trend Scout research; scripts are assembled "
                "by Story-to-Shorts and rendered by the Talking-Head Kit.\n")
    # schedule.md
    with open(os.path.join(args.out, "schedule.md"), "w") as f:
        f.write("# Posting schedule\n\n")
        f.write(f"- Cadence: **{args.per_week} videos/week** for 30 days "
                f"({len(rows)} videos)\n")
        f.write(f"- YouTube Shorts: **{POST_TIMES['youtube']}** local time — "
                "title + hashtags from each pack.md\n")
        f.write(f"- TikTok: **{POST_TIMES['tiktok']}** local time — same video, "
                "caption rewritten natively (ClipSmith plan)\n")
        f.write("- Batch day: render the whole week in one sitting "
                "(scripts are ready in `scripts/`).\n\n")
        f.write("## The chain per video\n\n"
                "1. Topic picked from the calendar (Trend Scout slot)\n"
                "2. Script: `scripts/day-XX-*/script.txt` (Story-to-Shorts format)\n"
                "3. Voice: record your own or use any TTS you choose — one audio file\n"
                "4. Render: Talking-Head Kit `pipeline.py --script script.txt "
                "--photo avatar.png --audio voice.mp3 --out video.mp4`\n"
                "5. Captions/clips polish: ClipSmith plan from the same script\n"
                "6. Post per the times above; reply to comments within 1 hour "
                "(Launch Autopilot rota)\n")
    # checklist.md
    with open(os.path.join(args.out, "checklist.md"), "w") as f:
        f.write("# Checklists\n\n## Per video\n\n"
                "- [ ] Facts checked against a real source\n"
                "- [ ] script.txt reads well aloud (one idea per sentence)\n"
                "- [ ] Voice audio recorded/exported, no clipping\n"
                "- [ ] Rendered 1080x1920, subtitles burned in and legible\n"
                "- [ ] Title + hashtags copied from pack.md\n"
                "- [ ] Posted at the scheduled time on both platforms\n"
                "- [ ] First comment pinned (question from the script close)\n"
                "- [ ] Comments answered within the first hour\n\n"
                "## Channel launch (once)\n\n"
                "- [ ] Channel name + handle chosen from channel-setup.md\n"
                "- [ ] Banner uses the niche banner line, readable on mobile\n"
                "- [ ] Description pasted from channel-setup.md template\n"
                "- [ ] Avatar: one consistent photo/illustration for every video\n"
                "- [ ] First 3 videos uploaded before announcing anywhere\n"
                "- [ ] Playlist created for the series\n")
    # channel-setup.md (all 5 niches)
    with open(os.path.join(args.out, "channel-setup.md"), "w") as f:
        f.write("# Channel setup guide — templates for 5 niches\n\n")
        f.write("Faceless means no on-camera presence: a consistent avatar "
                "image, your voice (recorded or any TTS you choose) and "
                "burned-in subtitles carry every video.\n")
        for key in NICHE_ORDER:
            m = NICHES[key]
            f.write(f"\n## {m['label']}\n\n")
            f.write("**Channel name options:** " + " · ".join(m["names"]) + "\n\n")
            f.write(f"**Banner line:** {m['banner']}\n\n")
            f.write("**Description template:**\n\n"
                    f"> {m['banner']}. New videos on a fixed schedule — "
                    "scripted from real sources, sources in the comments. "
                    "Business: kontenlaris.studio@gmail.com\n\n")
            f.write(f"**Hashtags:** {m['hashtags']}\n")
    # pack-summary.md
    with open(os.path.join(args.out, "pack-summary.md"), "w") as f:
        f.write(f"# Faceless Channel Pack — summary\n\n"
                f"- Niche: **{meta['label']}** (`{niche}`)\n"
                f"- Window: {start.isoformat()} + 30 days\n"
                f"- Videos planned: **{len(rows)}** at {args.per_week}/week\n"
                f"- Scripts: `scripts/` — each with script.txt + pack.md\n"
                f"- Files: calendar.csv, calendar.md, schedule.md, "
                f"checklist.md, channel-setup.md\n\n"
                "Next step: pick a channel name in channel-setup.md, record "
                "the day-01 voice track, and render the first video.\n")
    return rows


def selftest():
    checks = []

    def ok(name, cond):
        checks.append((name, bool(cond)))

    with tempfile.TemporaryDirectory() as td:
        class A:  # noqa: D401 - minimal args namespace
            pass
        a = A()
        a.topics, a.niche, a.per_week = None, "history", 7
        a.start, a.platform, a.out = "2026-12-01", "both", os.path.join(td, "pack")
        rows = build_pack(a)
        for fn in ["calendar.csv", "calendar.md", "schedule.md",
                   "checklist.md", "channel-setup.md", "pack-summary.md"]:
            ok(f"exists {fn}", os.path.isfile(os.path.join(a.out, fn)))
        ok("30 videos at 7/week", len(rows) == 30)
        csv_rows = list(csv.reader(open(os.path.join(a.out, "calendar.csv"))))
        ok("calendar.csv 31 lines (header+30)", len(csv_rows) == 31)
        setup = open(os.path.join(a.out, "channel-setup.md")).read()
        ok("setup covers 5 niches",
           all(NICHES[k]["label"] in setup for k in NICHE_ORDER))
        good = 0
        for r in rows:
            p = os.path.join(a.out, "scripts", r["folder"], "script.txt")
            txt = open(p).read().strip()
            if txt and 40 <= len(txt.split()) <= 220 and TURN in txt:
                good += 1
        ok("all scripts well-formed", good == len(rows))
        # topics-JSON path
        tj = os.path.join(td, "t.json")
        json.dump([{"topic": "A test topic", "angle": "myth",
                    "facts": ["Fact one stands here.", "Fact two follows it."]}],
                  open(tj, "w"))
        a.topics, a.out = tj, os.path.join(td, "pack2")
        rows2 = build_pack(a)
        ok("topics JSON path works", len(rows2) == 30 and
           os.path.isfile(os.path.join(a.out, "calendar.md")))
        a.topics, a.per_week, a.out = None, 3, os.path.join(td, "pack3")
        rows3 = build_pack(a)
        ok("3/week gives 12-13 videos", 12 <= len(rows3) <= 13)
    failed = [n for n, c in checks if not c]
    for n, c in checks:
        print(("PASS " if c else "FAIL ") + n)
    print(f"SELFTEST {len(checks) - len(failed)}/{len(checks)} passed")
    return 1 if failed else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--niche", default="history")
    ap.add_argument("--topics", help="topics JSON file (overrides niche bank)")
    ap.add_argument("--out", default="channel-pack")
    ap.add_argument("--per-week", type=int, default=7, choices=list(WEEKDAY_SETS))
    ap.add_argument("--start", default="2026-12-01", help="YYYY-MM-DD")
    ap.add_argument("--platform", default="both",
                    choices=["youtube", "tiktok", "both"])
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    rows = build_pack(a)
    print(f"OK channel pack in {a.out}/ — {len(rows)} videos planned "
          f"(calendar.csv, {len(rows)} script packs, schedule, checklists, setup)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
