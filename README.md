# Duka Shop Manager

A lightweight inventory and sales manager for small shops, built as an installable Progressive Web App with an AI assistant that reads and explains your business data.

**Live app:** https://dukashopmanager.pages.dev

## What it does

- Track products, stock levels, and sales
- Full stock movement audit trail (every change is logged, not just an editable quantity field)
- Record sales and see a live dashboard
- Ask the built in AI assistant questions about your business data (read only, it does not edit inventory or prices)
- Import products, stock, and sales from CSV/Excel, with AI assisted column mapping
- Multi shop support, each with its own products, sales, and settings
- Works offline as an installable PWA, add it to your home screen like a native app
- Nigerian Naira (₦) by default, configurable for other currencies
- User accounts with signup, login, password reset via security question
- Paystack subscription billing for paid plans

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
├── index.html              App shell
├── service-worker.js       Offline caching
├── manifest.json           PWA manifest
├── tailwind.config.js      Tailwind build config
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

## Deployment

Frontend deploys automatically via Cloudflare Pages on every push to `main` (no build command, output directory is repo root). Backend deploys separately with `npx wrangler deploy`.

## Status

Active development. Built and maintained by [CodeVent Digital](https://codeventdigital.site).

## License

All rights reserved.
