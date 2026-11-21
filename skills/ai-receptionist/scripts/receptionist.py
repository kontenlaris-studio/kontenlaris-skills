#!/usr/bin/env python3
"""receptionist.py — AI Receptionist core engine for small businesses.

Deterministic, stdlib only, offline. The receptionist answers ONLY from
the business's own JSON data (services, prices, hours, FAQ pairs). It
never invents a price, a service or an opening hour: when a question
cannot be answered from that data, or the customer is unhappy, the
conversation is escalated to the human owner and a callback is offered.

Capabilities:
  greeting          first contact + business summary
  faq               keyword / token-overlap matching over the FAQ pairs
  services & prices answered from the services list, nothing else
  hours             per-weekday hours, closed days, holiday dates
  booking           proposes only free slots; no double-booking; closed
                    dates and outside-hours requests are rejected with
                    the nearest free alternatives
  callback          captures a phone number + reason for the owner
  escalation        complaint / payment-dispute keywords, or low
                    confidence, hand the chat to the owner

State: bookings live in a local JSON file (bookings.json) so a restart
never loses an appointment.

Usage:
  python3 receptionist.py --business salon.json --script chat.json \
      --out sample-pack/ [--today 2026-11-23]
  python3 receptionist.py --selftest

Business JSON:
  {"name": "...", "type": "salon|clinic|workshop|rental|course",
   "city": "...", "language": "id|en",
   "hours": {"mon": ["09:00", "20:00"], ..., "sun": null},
   "slot_minutes": 60, "closed_dates": ["2026-12-25"],
   "services": [{"name": "...", "price_idr": 35000, "minutes": 45,
                 "keywords": ["potong", "gunting"]}],
   "faqs": [{"q": "...", "a": "...", "keywords": ["parkir"]}]}

Script JSON: a list of customer messages (strings), answered in order.
The optional object form {"messages": [...], "today": "YYYY-MM-DD"}
pins the reference date so runs are reproducible.
"""
import argparse, json, os, re, sys, tempfile
from datetime import date, datetime, time, timedelta

DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
DAY_NAMES_ID = {"mon": "Senin", "tue": "Selasa", "wed": "Rabu", "thu": "Kamis",
                "fri": "Jumat", "sat": "Sabtu", "sun": "Minggu"}
DAY_WORDS = {  # words a customer might type -> weekday index (Mon=0)
    "senin": 0, "monday": 0, "selasa": 1, "tuesday": 1, "rabu": 2,
    "wednesday": 2, "kamis": 3, "thursday": 3, "jumat": 4, "friday": 4,
    "sabtu": 5, "saturday": 5, "minggu": 6, "sunday": 6}
ESCALATION_WORDS = ["komplain", "kecewa", "marah", "refund", "uang kembali",
                    "tuntut", "lapor", "penipuan", "dispute", "chargeback",
                    "salah potong", "rusak", "complaint", "angry", "lawyer"]
CALLBACK_WORDS = ["telepon saya", "telpon saya", "hubungi saya", "callback",
                  "call me", "minta ditelepon", "minta ditelpon"]
BOOKING_WORDS = ["booking", "reservasi", "janji", "daftar", "book", "pesan jadwal",
                 "appointment", "reserve"]
STOPWORDS = set("yang dan di ke dari untuk apa apakah bisa mau saya ingin hari ini "
                "jam berapa ada tidak dengan ini itu kak min admin the a an is it "
                "do you have can i".split())


def norm(s):
    return re.sub(r"[^a-z0-9 ]", " ", s.lower()).split()


def fmt_idr(n):
    return "Rp" + f"{n:,}".replace(",", ".")


def parse_hhmm(s):
    h, m = s.split(":")
    return time(int(h), int(m))


class Receptionist:
    def __init__(self, business, today=None, bookings=None):
        self.b = business
        self.lang = business.get("language", "id")
        self.today = today or date.today()
        self.bookings = bookings if bookings is not None else []
        self.pending = None          # partial booking being collected
        self.escalations = []
        self.callbacks = []
        self.greeted = False

    # ---------- text helpers ----------
    def t(self, id_text, en_text):
        return id_text if self.lang == "id" else en_text

    def score(self, msg_tokens, keywords, extra_text=""):
        kw = set()
        for k in keywords or []:
            kw.update(norm(k))
        extra = set(norm(extra_text)) - STOPWORDS
        hits = len((set(msg_tokens) - STOPWORDS) & (kw | extra))
        return hits

    # ---------- knowledge lookups (business JSON only) ----------
    def match_faq(self, tokens):
        best, best_score = None, 0
        for f in self.b.get("faqs", []):
            s = self.score(tokens, f.get("keywords"), f["q"])
            if s > best_score:
                best, best_score = f, s
        return best if best_score >= 1 else None

    def match_service(self, tokens):
        best, best_score = None, 0
        for s in self.b.get("services", []):
            sc = self.score(tokens, s.get("keywords"), s["name"])
            if sc > best_score:
                best, best_score = s, sc
        return best if best_score >= 1 else None

    def distinctive_service(self, tokens):
        """Service identified by a token unique to it (e.g. 'potong'),
        ignoring words shared across services (e.g. 'rambut')."""
        sets = []
        for s in self.b.get("services", []):
            st = set(norm(s["name"]))
            for k in s.get("keywords", []):
                st.update(norm(k))
            sets.append((s, st - STOPWORDS))
        for s, st in sets:
            others = set().union(*(o for x, o in sets if x is not s)) if len(sets) > 1 else set()
            if set(tokens) & (st - others):
                return s
        return None

    def hours_for(self, d):
        if d.isoformat() in self.b.get("closed_dates", []):
            return None
        h = self.b.get("hours", {}).get(DAYS[d.weekday()])
        return h  # None = closed that weekday, else [open, close]

    def hours_text(self, d):
        h = self.hours_for(d)
        name = DAY_NAMES_ID[DAYS[d.weekday()]] if self.lang == "id" else d.strftime("%A")
        if h is None:
            return self.t(f"Hari {name} ({d.isoformat()}) kami tutup.",
                          f"We are closed on {name} ({d.isoformat()}).")
        return self.t(f"Hari {name} ({d.isoformat()}) kami buka pukul {h[0]}–{h[1]}.",
                      f"On {name} ({d.isoformat()}) we are open {h[0]}–{h[1]}.")

    # ---------- booking ----------
    def free_slots(self, d, minutes):
        h = self.hours_for(d)
        if h is None:
            return []
        step = int(self.b.get("slot_minutes", 60))
        start = datetime.combine(d, parse_hhmm(h[0]))
        end = datetime.combine(d, parse_hhmm(h[1]))
        out, cur = [], start
        while cur + timedelta(minutes=minutes) <= end:
            clash = any(
                cur < datetime.fromisoformat(bk["end"]) and
                datetime.fromisoformat(bk["start"]) < cur + timedelta(minutes=minutes)
                for bk in self.bookings if bk["date"] == d.isoformat())
            if not clash:
                out.append(cur.strftime("%H:%M"))
            cur += timedelta(minutes=step)
        return out

    def parse_when(self, msg, tokens):
        """Extract (date, time) a customer asked for, or (None, None)."""
        d = None
        m = re.search(r"(20\d{2})-(\d{2})-(\d{2})", msg)
        if m:
            d = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        elif "lusa" in tokens:
            d = self.today + timedelta(days=2)
        elif "besok" in tokens or "tomorrow" in tokens:
            d = self.today + timedelta(days=1)
        elif "hari" in tokens and "ini" in tokens or "today" in tokens:
            d = self.today
        else:
            for w, idx in DAY_WORDS.items():
                if w in tokens:
                    delta = (idx - self.today.weekday()) % 7 or 7
                    d = self.today + timedelta(days=delta)
                    break
        tm = None
        m = re.search(r"(?:jam\s*)?(\d{1,2})[:.](\d{2})", msg)
        if m:
            tm = f"{int(m.group(1)):02d}:{m.group(2)}"
        else:
            m = re.search(r"jam\s*(\d{1,2})\b", msg)
            if m:
                tm = f"{int(m.group(1)):02d}:00"
        return d, tm

    def try_booking(self, msg, tokens):
        svc = self.match_service(tokens)
        d, tm = self.parse_when(msg, tokens)
        p = self.pending or {}
        svc = svc or p.get("service")
        d = d or p.get("date")
        tm = tm or p.get("time")
        name = self.b["name"]
        if not svc:
            self.pending = {"date": d, "time": tm}
            items = ", ".join(s["name"] for s in self.b["services"])
            return self.t(f"Baik, mau booking layanan apa? Pilihan: {items}.",
                          f"Sure — which service would you like? Options: {items}."), "booking"
        if not d:
            self.pending = {"service": svc, "time": tm}
            return self.t(f"{svc['name']} — untuk hari apa? (hari ini / besok / tanggal)",
                          f"{svc['name']} — which day? (today / tomorrow / a date)"), "booking"
        if self.hours_for(d) is None:
            self.pending = {"service": svc}
            nxt = [self.hours_text(d + timedelta(days=i)) for i in (1, 2)
                   if self.hours_for(d + timedelta(days=i))]
            alt = " ".join(nxt[:1])
            return self.t(f"Maaf, {name} tutup pada {d.isoformat()}. {alt} "
                          f"Mau booking di hari buka terdekat?",
                          f"Sorry, {name} is closed on {d.isoformat()}. {alt} "
                          f"Shall I book the nearest open day?"), "booking_rejected_closed"
        slots = self.free_slots(d, svc["minutes"])
        if not slots:
            self.pending = {"service": svc}
            return self.t(f"Maaf, jadwal {d.isoformat()} untuk {svc['name']} sudah penuh. "
                          f"Coba hari lain ya.",
                          f"Sorry, {d.isoformat()} is fully booked for {svc['name']}. "
                          f"Please pick another day."), "booking_rejected_full"
        if not tm:
            self.pending = {"service": svc, "date": d}
            shown = ", ".join(slots[:6])
            return self.t(f"Slot kosong {d.isoformat()} untuk {svc['name']}: {shown}. "
                          f"Mau jam berapa?",
                          f"Free slots on {d.isoformat()} for {svc['name']}: {shown}. "
                          f"Which time?"), "booking"
        if tm not in slots:
            self.pending = {"service": svc, "date": d}
            shown = ", ".join(slots[:6])
            return self.t(f"Jam {tm} pada {d.isoformat()} sudah terisi / di luar jam layanan. "
                          f"Slot yang masih kosong: {shown}.",
                          f"{tm} on {d.isoformat()} is taken or outside service hours. "
                          f"Still free: {shown}."), "booking_rejected_taken"
        start = datetime.combine(d, parse_hhmm(tm))
        bk = {"service": svc["name"], "date": d.isoformat(), "time": tm,
              "start": start.isoformat(),
              "end": (start + timedelta(minutes=svc["minutes"])).isoformat(),
              "price_idr": svc["price_idr"]}
        self.bookings.append(bk)
        self.pending = None
        return self.t(f"Booking tercatat: {svc['name']} pada {d.isoformat()} jam {tm} "
                      f"({fmt_idr(svc['price_idr'])}). Mohon datang 10 menit lebih awal. "
                      f"Sampai jumpa di {name}!",
                      f"Booked: {svc['name']} on {d.isoformat()} at {tm} "
                      f"({fmt_idr(svc['price_idr'])}). Please arrive 10 minutes early. "
                      f"See you at {name}!"), "booked"

    # ---------- main entry ----------
    def reply(self, msg):
        low = msg.lower()
        tokens = norm(msg)
        # escalation first: an unhappy customer always reaches a human
        if any(w in low for w in ESCALATION_WORDS):
            self.escalations.append({"message": msg, "reason": "complaint_or_dispute",
                                     "date": self.today.isoformat()})
            return {"intent": "escalated",
                    "text": self.t("Mohon maaf atas ketidaknyamanannya. Saya teruskan "
                                   "langsung ke pemilik sekarang juga — beliau akan "
                                   "menghubungi Anda. Boleh tinggalkan nomor telepon "
                                   "yang bisa dihubungi?",
                                   "I'm sorry about that. I'm handing this to the owner "
                                   "right now — they will contact you. May I have a "
                                   "phone number to reach you?")}
        # callback capture (explicit request or a bare phone number)
        phone = re.search(r"(\+?62|0)8\d{7,11}", msg.replace(" ", "").replace("-", ""))
        if phone or any(w in low for w in CALLBACK_WORDS):
            num = phone.group(0) if phone else "(nomor belum diberikan)"
            self.callbacks.append({"phone": num, "message": msg,
                                   "date": self.today.isoformat()})
            return {"intent": "callback",
                    "text": self.t(f"Siap, permintaan telepon balik tercatat ({num}). "
                                   f"Pemilik akan menghubungi Anda pada jam buka. "
                                   f"Terima kasih!",
                                   f"Got it — callback noted ({num}). The owner will "
                                   f"call you during opening hours. Thank you!")}
        # A pending booking is abandoned when the customer changes the
        # subject: a message carrying no service, date or time and no
        # booking word is a new question, not a booking answer.
        if self.pending:
            pd, pt = self.parse_when(low, tokens)
            if not (self.distinctive_service(tokens) or pd or pt
                    or any(w in low for w in BOOKING_WORDS)):
                self.pending = None
        # booking flow (also continues a pending booking)
        if self.pending or any(w in low for w in BOOKING_WORDS):
            text, intent = self.try_booking(low, tokens)
            return {"intent": intent, "text": text}
        # hours
        if any(w in tokens for w in ("buka", "tutup", "jam", "open", "close", "hours")) and \
           any(w in tokens for w in list(DAY_WORDS) + ["hari", "kapan", "when", "besok", "lusa", "ini"]):
            d, _ = self.parse_when(low, tokens)
            return {"intent": "hours", "text": self.hours_text(d or self.today)}
        if any(w in tokens for w in ("buka", "tutup", "open", "close")):
            return {"intent": "hours", "text": self.hours_text(self.today)}
        # services & prices — answered from the services list only
        svc = self.match_service(tokens)
        if svc and any(w in tokens for w in ("harga", "berapa", "biaya", "tarif", "price", "cost", "much")):
            return {"intent": "price",
                    "text": self.t(f"{svc['name']}: {fmt_idr(svc['price_idr'])} "
                                   f"(±{svc['minutes']} menit). Mau sekalian booking?",
                                   f"{svc['name']}: {fmt_idr(svc['price_idr'])} "
                                   f"(about {svc['minutes']} min). Shall I book it?")}
        if any(w in tokens for w in ("layanan", "menu", "services", "list", "daftar")) and \
           not any(w in tokens for w in BOOKING_WORDS):
            items = "; ".join(f"{s['name']} {fmt_idr(s['price_idr'])}" for s in self.b["services"])
            return {"intent": "services",
                    "text": self.t(f"Layanan kami: {items}.", f"Our services: {items}.")}
        if svc:
            # A bare keyword overlap is not enough to answer: the customer
            # must actually ask about the service (price cue or full name),
            # otherwise the question is escalated instead of guessed at.
            cues = ("harga", "berapa", "biaya", "tarif", "price", "cost", "much",
                    "info", "detail", "ada")
            full_name = " ".join(norm(svc["name"]))
            if any(w in tokens for w in cues) or full_name in " ".join(tokens):
                return {"intent": "price",
                        "text": self.t(f"{svc['name']}: {fmt_idr(svc['price_idr'])} "
                                       f"(±{svc['minutes']} menit). Mau sekalian booking?",
                                       f"{svc['name']}: {fmt_idr(svc['price_idr'])} "
                                       f"(about {svc['minutes']} min). Shall I book it?")}
        # FAQ
        faq = self.match_faq(tokens)
        if faq:
            return {"intent": "faq", "text": faq["a"]}
        # greeting
        if not self.greeted and any(w in tokens for w in
                                    ("halo", "hai", "hello", "hi", "pagi", "siang", "sore", "malam", "assalamualaikum")):
            self.greeted = True
            return {"intent": "greeting",
                    "text": self.t(f"Halo, selamat datang di {self.b['name']} "
                                   f"({self.b.get('city', '')}). Ada yang bisa saya bantu? "
                                   f"Tanya harga, jam buka, atau booking — silakan.",
                                   f"Hello, welcome to {self.b['name']} "
                                   f"({self.b.get('city', '')}). Ask me about prices, "
                                   f"opening hours or booking.")}
        # low confidence -> escalate, never guess
        self.escalations.append({"message": msg, "reason": "low_confidence",
                                 "date": self.today.isoformat()})
        return {"intent": "escalated",
                "text": self.t("Untuk hal itu saya belum punya datanya, jadi saya "
                               "teruskan ke pemilik agar dijawab dengan benar. Boleh "
                               "tinggalkan nomor telepon agar dihubungi kembali?",
                               "I don't have that in my data, so I'll pass it to the "
                               "owner to answer correctly. May I have a phone number "
                               "for a callback?")}


def run_conversation(business, messages, today=None, bookings_path=None):
    prior = []
    if bookings_path and os.path.exists(bookings_path):
        prior = json.loads(open(bookings_path, encoding="utf-8").read())
    r = Receptionist(business, today=today, bookings=prior)
    turns = []
    for m in messages:
        out = r.reply(m)
        turns.append({"customer": m, "intent": out["intent"], "receptionist": out["text"]})
    if bookings_path:
        with open(bookings_path, "w", encoding="utf-8") as f:
            json.dump(r.bookings, f, indent=2, ensure_ascii=False)
    return r, turns


def transcript_md(business, turns, r):
    lines = [f"# {business['name']} — receptionist demo transcript", "",
             f"Business type: {business.get('type', '-')} · City: {business.get('city', '-')} · "
             f"Reference date: {r.today.isoformat()}", ""]
    for t in turns:
        lines += [f"**Customer:** {t['customer']}",
                  f"**Receptionist** _(intent: {t['intent']})_: {t['receptionist']}", ""]
    lines += ["## Session summary",
              f"- Bookings made: {len(r.bookings)}",
              f"- Callbacks captured: {len(r.callbacks)}",
              f"- Escalations to owner: {len(r.escalations)}"]
    for bk in r.bookings:
        lines.append(f"  - {bk['date']} {bk['time']} — {bk['service']} ({fmt_idr(bk['price_idr'])})")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------- self-test
def sample_business():
    return {
        "name": "Salon Ayu", "type": "salon", "city": "Sidoarjo", "language": "id",
        "hours": {"mon": ["09:00", "20:00"], "tue": ["09:00", "20:00"],
                  "wed": ["09:00", "20:00"], "thu": ["09:00", "20:00"],
                  "fri": ["09:00", "20:00"], "sat": ["09:00", "20:00"],
                  "sun": ["10:00", "17:00"]},
        "slot_minutes": 60, "closed_dates": ["2026-12-25"],
        "services": [
            {"name": "Potong rambut", "price_idr": 35000, "minutes": 45,
             "keywords": ["potong", "gunting", "rambut"]},
            {"name": "Creambath", "price_idr": 60000, "minutes": 60,
             "keywords": ["creambath", "krim"]},
            {"name": "Pewarnaan rambut", "price_idr": 150000, "minutes": 120,
             "keywords": ["warna", "cat", "semir", "pewarnaan"]}],
        "faqs": [
            {"q": "Apakah ada parkir?", "a": "Ada — parkir motor dan mobil gratis di depan salon.",
             "keywords": ["parkir"]},
            {"q": "Bisa bayar pakai apa saja?",
             "a": "Kami menerima tunai, QRIS, dan transfer bank.",
             "keywords": ["bayar", "qris", "pembayaran", "transfer"]},
            {"q": "Apakah harus reservasi dulu?",
             "a": "Boleh datang langsung, tapi booking lebih aman agar tidak menunggu.",
             "keywords": ["reservasi", "antri", "menunggu", "langsung"]}]}


def selftest():
    today = date(2026, 11, 23)  # a Monday
    b = sample_business()
    checks = []
    def conv(msgs):
        return run_conversation(b, msgs, today=today)
    # 1 FAQ hit
    _, t = conv(["Apakah ada parkir di salon?"])
    checks.append(("faq hit", t[0]["intent"] == "faq" and "parkir" in t[0]["receptionist"].lower()))
    # 2 hours answer (Sunday hours differ)
    _, t = conv(["Hari minggu buka jam berapa?"])
    checks.append(("hours answer", t[0]["intent"] == "hours" and "10:00" in t[0]["receptionist"]))
    # 3 price from services only
    _, t = conv(["Harga potong rambut berapa?"])
    checks.append(("price answer", t[0]["intent"] == "price" and "Rp35.000" in t[0]["receptionist"]))
    # 4 booking success
    r, t = conv(["Booking potong rambut besok jam 10:00"])
    checks.append(("booking success", t[0]["intent"] == "booked" and len(r.bookings) == 1
                   and r.bookings[0]["date"] == "2026-11-24"))
    # 5 double-book rejected with alternatives (same conversation state)
    out = r.reply("Booking potong rambut besok jam 10:00")
    checks.append(("double-book rejected", out["intent"] == "booking_rejected_taken"
                   and len(r.bookings) == 1))
    # 6 closed-day rejected
    _, t = conv(["Booking creambath tanggal 2026-12-25 jam 10:00"])
    checks.append(("closed-day rejected", t[0]["intent"] == "booking_rejected_closed"))
    # 7 outside-hours rejected
    _, t = conv(["Booking potong rambut besok jam 21:00"])
    checks.append(("outside-hours rejected", t[0]["intent"] == "booking_rejected_taken"))
    # 8 complaint escalates
    r2, t = conv(["Saya kecewa, hasil potongnya rusak! Saya mau refund"])
    checks.append(("complaint escalates", t[0]["intent"] == "escalated" and len(r2.escalations) == 1))
    # 9 unknown question escalates instead of hallucinating
    r3, t = conv(["Apakah salon menjual vitamin rambut merek X?"])
    checks.append(("unknown escalates", t[0]["intent"] == "escalated"
                   and r3.escalations[0]["reason"] == "low_confidence"))
    # 10 callback captured
    r4, t = conv(["Tolong telepon saya di 081234567890 ya"])
    checks.append(("callback captured", t[0]["intent"] == "callback" and len(r4.callbacks) == 1
                   and "081234567890" in r4.callbacks[0]["phone"]))
    # 11 bookings persist to a JSON file
    with tempfile.TemporaryDirectory() as td:
        p = os.path.join(td, "bookings.json")
        run_conversation(b, ["Booking creambath besok jam 13:00"], today=today, bookings_path=p)
        saved = json.loads(open(p, encoding="utf-8").read())
    checks.append(("bookings file saved", len(saved) == 1 and saved[0]["service"] == "Creambath"))
    # 12 greeting
    _, t = conv(["Halo kak"])
    checks.append(("greeting", t[0]["intent"] == "greeting" and "Salon Ayu" in t[0]["receptionist"]))
    failed = [n for n, ok in checks if not ok]
    for n, ok in checks:
        print(("PASS" if ok else "FAIL"), n)
    print(f"selftest: {len(checks) - len(failed)}/{len(checks)}")
    return 1 if failed else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--business")
    ap.add_argument("--script")
    ap.add_argument("--out")
    ap.add_argument("--today")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    business = json.loads(open(a.business, encoding="utf-8").read())
    raw = json.loads(open(a.script, encoding="utf-8").read())
    if isinstance(raw, dict):
        messages, pinned = raw["messages"], raw.get("today")
    else:
        messages, pinned = raw, None
    today = None
    for cand in (a.today, pinned):
        if cand:
            today = date.fromisoformat(cand)
            break
    os.makedirs(a.out, exist_ok=True)
    bookings_path = os.path.join(a.out, "bookings.json")
    if os.path.exists(bookings_path):
        os.remove(bookings_path)  # a demo run always starts from a clean book
    r, turns = run_conversation(business, messages, today=today, bookings_path=bookings_path)
    with open(os.path.join(a.out, "transcript.md"), "w", encoding="utf-8") as f:
        f.write(transcript_md(business, turns, r))
    print(f"wrote {a.out}/transcript.md + bookings.json "
          f"({len(turns)} turns, {len(r.bookings)} bookings, "
          f"{len(r.callbacks)} callbacks, {len(r.escalations)} escalations)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
