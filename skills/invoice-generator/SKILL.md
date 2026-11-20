---
name: invoice-generator
description: Generate a professional invoice (HTML, print/PDF-ready) from structured business, client and line-item data, with correct subtotal, discount, tax and multi-currency totals, EN/ID labels, PAID/UNPAID stamp, payment instructions and accent colors.
---

# Invoice Generator

Turn structured billing data into a clean, professional invoice document.

## What it does

Given the seller, the client, line items, a currency, an optional discount % and tax %, this skill produces a self-contained HTML invoice (open it in any browser, print or save as PDF) with the totals computed for you: subtotal, discount, tax on the discounted amount, and the grand total.

v2 mirrors the InvoiceKit web app v2:

- **8 currencies**: USD, IDR, EUR, GBP, SGD, JPY, AUD, MYR, with locale-correct formatting (IDR and JPY use no decimals; IDR uses dot thousands separators).
- **English / Bahasa Indonesia** labels via `lang` (`en` / `id`), including the document title (INVOICE / FAKTUR).
- **Status stamp** via `status` (`paid` / `unpaid`): PAID / LUNAS or UNPAID / BELUM LUNAS, print-ready.
- **Payment instructions** via `payment`: a dedicated block for bank account, QRIS or e-wallet details, separate from `notes`.
- **Accent colors** via `accent`: `orange`, `teal`, `violet`, `rose`.
- **Optional logo** via `logo_data`: a `data:image/...` URL embedded as-is (never fetched).

This is the engine behind the free web tool [InvoiceKit](https://kontenlaris-studio.github.io/invoicekit/) — same math, same layout, usable inside an agent workflow. The web app adds browser-side extras on top: multi-invoice storage, automatic numbering, saved clients and JSON backup/restore.

## How to use

1. Build a JSON spec: `business`, `business_meta`, `client`, `client_meta`, `number`, `currency`, `issued`, `due`, `tax_pct`, `discount_pct`, `notes`, plus optional `payment`, `status`, `lang`, `accent`, `logo_data`, and `items` (each `{desc, qty, price}`).
2. Run `scripts/make_invoice.py spec.json` (or pipe the JSON on stdin) — it prints the invoice HTML.
3. All user-visible strings are HTML-escaped by the renderer; totals are computed, never hand-written.

## Behavior and limits (declared honestly)

- The script is pure computation: it reads only the JSON file/stdin you give it and writes only to stdout. **No network access, no environment variables, no writes to disk.**
- Tax is applied after discount — the common invoicing convention. If your jurisdiction differs, adjust the spec, not the math.
- One currency per invoice; multi-currency invoices are out of scope.
