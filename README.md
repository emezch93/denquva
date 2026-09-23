# Duka Shop Manager

A shop management Progressive Web App for small businesses: inventory, sales, credit sales, and an AI assistant that reads and explains your business data.

**Live app:** https://dukashopmanager.pages.dev

## What it does

**Inventory**
- Track products, stock levels, prices, and categories
- Full stock movement audit trail (every change is logged, not an editable quantity field)

**Sales**
- Multi Sale: build a cart of several products, with quantity steppers and frequently sold quick-add suggestions, and check out in one confirm instead of selling item by item
- Every sale is tappable to view its full detail (unit price, cost, profit, exact time), banking-app style, instead of everything crammed into the list row
- Sales history filterable by Today / This week / This month / All, with revenue and profit totals

**Credit Sales**
- Record a customer's name, the products they're taking on credit (cart style, same as Multi Sale), a discount, and the purchase date
- Stock updates immediately, payment status stays Pending until settled
- Multi-select several pending credit sales and mark them all Paid at once, which records them into the real sales/revenue totals on the date they were actually paid, not the date they were taken
- Search, filter by status, sort by customer/status/date/outstanding, tap any record for full detail

**AI assistant**
- Read only: answers questions about your dashboard, sales, top products, and credit sales; it does not edit inventory, prices, or anything else
- Reads uploaded receipts/invoices (photo or file) and remembers what's in them for future questions
- Voice input, transcribed then answered the same way as typed questions

**Data import**
- Bulk CSV/Excel import for products, sales, and stock; re-uploading a file updates existing products (matched by SKU or name) instead of failing on duplicates
- Smart import: any column layout, AI maps it to Duka's fields, with a review step before anything is saved; supports multiple files in one go, processed one at a time

**Accounts & billing**
- Signup/login, password reset via security question
- Multi shop/branch support under one login, each with its own products, sales, and settings
- Paystack subscription billing (quarterly), trial period, Settings page reflects live status (Subscribed / Subscribe now)

**Other**
- Nigerian Naira (₦) by default, configurable
- Installable PWA, works offline, add to home screen
- SEO: canonical tag, sitemap.xml, robots.txt, structured data, CodeVent Digital brand attribution

## Stack

- **Frontend:** vanilla JavaScript, HTML, Tailwind CSS (compiled, not the CDN build)
- **Backend:** Cloudflare Workers
- **Database:** Cloudflare D1
- **AI:** Google Gemini API
- **Payments:** Paystack
- **PWA:** offline service worker with cache versioning

No frameworks, no Node backend, no external database service.

## Project structure

```
duka-shop-manager/
├── index.html              App shell, meta tags, canonical/SEO tags
├── service-worker.js       Offline caching
├── manifest.json           PWA manifest
├── robots.txt / sitemap.xml
├── tailwind.config.js      Tailwind build config
├── migrations/
│   └── credit_sales.sql     Run once against D1 before deploying credit sales
├── css/
│   ├── tailwind.css         Compiled Tailwind output
│   └── app.css               Custom styles
├── js/
│   └── app.js                 All application logic and UI rendering
└── icons/                   PWA icons
```

The backend (Cloudflare Worker + D1) lives in a separate `worker.js`, deployed independently via `wrangler`.

## Local development

This is a static frontend, no build server required to run it.

1. Clone the repo
2. Serve the folder with any static server, e.g. `npx serve .`
3. Open in your browser

If you change any Tailwind classes in `index.html` or `js/app.js`, rebuild the CSS:

```
npm install
npx tailwindcss -i ./css/tailwind-input.css -o ./css/tailwind.css --minify
```

Bump `CACHE_NAME` in `service-worker.js` on every deploy that changes `index.html`, `app.js`, or the CSS, otherwise returning users keep the old cached version.

## Deployment

Frontend deploys automatically via Cloudflare Pages on every push to `main` (no build command, output directory is repo root). Backend deploys separately with `npx wrangler deploy`. Any new migration under `migrations/` needs to be run against D1 once before the matching backend code goes live.

## Status

Active development. Built and maintained by [CodeVent Digital](https://codeventdigital.site).

## License

All rights reserved.
