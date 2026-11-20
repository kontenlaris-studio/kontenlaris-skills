#!/usr/bin/env python3
"""Render a self-contained HTML invoice from a JSON spec (file arg or stdin).

Spec: {business, business_meta, client, client_meta, number, currency,
       issued, due, tax_pct, discount_pct, notes, payment, status, lang,
       accent, logo_data, items: [{desc, qty, price}]}
Mirrors InvoiceKit web v2: 8 currencies (USD, IDR, EUR, GBP, SGD, JPY, AUD,
MYR), EN/ID labels, PAID/UNPAID stamp, payment instructions block, accent
colors, optional logo (data:image URL only, embedded as-is, never fetched).
No network, no environment access; reads only the given file/stdin, writes
only stdout.
"""
import html
import json
import sys

SYM = {"USD": "$", "IDR": "Rp", "EUR": "€", "GBP": "£", "SGD": "S$",
       "JPY": "¥", "AUD": "A$", "MYR": "RM"}
NO_DEC = {"IDR", "JPY"}
ACCENTS = {"orange": "#ff7a00", "teal": "#0e7a6d", "violet": "#6d28d9", "rose": "#e11d63"}
LABELS = {
    "en": {"title": "INVOICE", "from": "From", "to": "Billed to", "desc": "Description",
           "qty": "Qty", "price": "Price", "amount": "Amount", "sub": "Subtotal",
           "disc": "Discount", "tax": "Tax", "total": "Total due", "pay": "Payment",
           "notes": "Notes", "issued": "Issued", "due": "Due",
           "paid": "PAID", "unpaid": "UNPAID"},
    "id": {"title": "FAKTUR", "from": "Dari", "to": "Ditagihkan ke", "desc": "Deskripsi",
           "qty": "Jml", "price": "Harga", "amount": "Jumlah", "sub": "Subtotal",
           "disc": "Diskon", "tax": "Pajak", "total": "Total tagihan", "pay": "Pembayaran",
           "notes": "Catatan", "issued": "Terbit", "due": "Jatuh tempo",
           "paid": "LUNAS", "unpaid": "BELUM LUNAS"},
}


def money(n, cur):
    if cur in NO_DEC:
        s = f"{n:,.0f}"
        if cur == "IDR":
            s = s.replace(",", ".")
        return SYM.get(cur, cur + " ") + " " + s
    return SYM.get(cur, cur + " ") + " " + f"{n:,.2f}"


def render(spec):
    cur = spec.get("currency", "USD")
    L = LABELS.get(spec.get("lang", "en"), LABELS["en"])
    acc = ACCENTS.get(spec.get("accent", "orange"), ACCENTS["orange"])
    items = spec.get("items", [])
    subtotal = sum(float(i.get("qty", 0)) * float(i.get("price", 0)) for i in items)
    discount = subtotal * float(spec.get("discount_pct", 0)) / 100
    tax = (subtotal - discount) * float(spec.get("tax_pct", 0)) / 100
    total = subtotal - discount + tax
    rows = "".join(
        f"<tr><td>{html.escape(str(i.get('desc','')))}</td><td style='text-align:right'>{i.get('qty',0)}</td>"
        f"<td style='text-align:right'>{money(float(i.get('price',0)), cur)}</td>"
        f"<td style='text-align:right'>{money(float(i.get('qty',0))*float(i.get('price',0)), cur)}</td></tr>"
        for i in items)
    paid = str(spec.get("status", "unpaid")).lower() == "paid"
    stamp_txt = L["paid"] if paid else L["unpaid"]
    stamp_col = "#0e7a3d" if paid else "#c0392b"
    logo = str(spec.get("logo_data", ""))
    logo_html = f"<img src='{html.escape(logo)}' style='max-height:56px;max-width:150px'>" if logo.startswith("data:image/") else ""
    pay = str(spec.get("payment", ""))
    pay_html = f"<h4>{L['pay']}</h4><pre>{html.escape(pay)}</pre>" if pay else ""
    notes = str(spec.get("notes", ""))
    notes_html = f"<h4>{L['notes']}</h4><pre>{html.escape(notes)}</pre>" if notes else ""
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>{L['title']} {html.escape(str(spec.get('number','')))}</title>
<style>body{{font:15px system-ui;color:#14213d;max-width:760px;margin:40px auto;padding:0 20px;position:relative}}
h1{{color:#0a1931;letter-spacing:2px}}table{{width:100%;border-collapse:collapse;margin-top:16px}}
th{{background:#0a1931;color:#fff;text-align:left;padding:8px}}td{{padding:8px;border-bottom:1px solid #e3e9f2}}
.tot{{margin-left:auto;width:280px}}.tot div{{display:flex;justify-content:space-between;padding:4px 0}}
.grand{{border-top:2px solid #0a1931;font-weight:800;font-size:17px}}.grand span:last-child{{color:{acc}}}
pre{{white-space:pre-wrap;font:inherit;color:#66788f}}h4{{color:#66788f;text-transform:uppercase;font-size:12px;letter-spacing:.6px;margin:18px 0 2px}}
.stamp{{position:absolute;top:90px;right:20px;transform:rotate(-12deg);border:4px solid {stamp_col};color:{stamp_col};font-weight:800;font-size:22px;letter-spacing:2px;padding:4px 16px;border-radius:8px;opacity:.85}}
.top{{border-bottom:3px solid {acc};padding-bottom:12px;display:flex;justify-content:space-between;align-items:center}}</style></head><body>
<div class="stamp">{stamp_txt}</div>
<div class="top"><div>{logo_html}<h1>{L['title']}</h1></div>
<p><b>{html.escape(str(spec.get('number','')))}</b> · {L['issued']} {html.escape(str(spec.get('issued','')))} · {L['due']} {html.escape(str(spec.get('due','')))}</p></div>
<p><b>{L['from']}:</b> {html.escape(str(spec.get('business','')))}</p><pre>{html.escape(str(spec.get('business_meta','')))}</pre>
<p><b>{L['to']}:</b> {html.escape(str(spec.get('client','')))}</p><pre>{html.escape(str(spec.get('client_meta','')))}</pre>
<table><tr><th>{L['desc']}</th><th style="text-align:right">{L['qty']}</th><th style="text-align:right">{L['price']}</th><th style="text-align:right">{L['amount']}</th></tr>{rows}</table>
<div class="tot"><div><span>{L['sub']}</span><span>{money(subtotal, cur)}</span></div>
<div><span>{L['disc']}</span><span>- {money(discount, cur)}</span></div>
<div><span>{L['tax']}</span><span>+ {money(tax, cur)}</span></div>
<div class="grand"><span>{L['total']}</span><span>{money(total, cur)}</span></div></div>
{pay_html}{notes_html}</body></html>"""


if __name__ == "__main__":
    data = open(sys.argv[1]).read() if len(sys.argv) > 1 else sys.stdin.read()
    print(render(json.loads(data)))
