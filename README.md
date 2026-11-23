# Denquva

Denquva helps business owners manage products, inventory, sales, profit, customer credit, debts, and multiple shops in one place, with an AI powered business assistance.

**Live app:** https://denquva.pages.dev

## What it does

**Reverse a sale**
- A sale made by mistake can be reversed from three places: the **Reverse this sale** button on a sale's details (Sales page), the **Sold the wrong item? Reverse this sale** link on the receipt, and an **Undo** bar that shows for a few seconds after a single sale
- The sale is removed from sales, revenue, profit, the dashboard, reports and the AI. A full copy is kept in `sale_reversals` with the reason and the time
- The items go back into stock by default. The owner can untick **Put the items back in stock** (for example for an imported sale that never took stock). The stock history gets a "Sale #N reversed" entry
- **Sales, Reversed** lists every reversed sale. Reversing the same sale twice, or at the same moment from two screens, only ever happens once
- Money is never sent back by Denquva. The screen reminds the owner to refund a customer who already paid by card or transfer

**Customer delivery**
- A shop can publish a customer order link, collect delivery details, accept requests for owner/staff-driver delivery or a courier, and share a private tracking link
- Accepted delivery requests reserve stock; successful delivery records the sale and stock movement atomically. Failed, returned, cancelled, or rejected requests release the reservation without recording a sale
- Owner-driver location sharing uses the browser/device location permission while the delivery screen is open. It is not guaranteed to continue when the app is closed or the device is locked
- Courier rates, shipping labels, and automatic tracking webhooks are available through each shop owner's EasyPost account; carrier/country availability is determined by that account and the carrier
- Delivery requires the `20261017_delivery.sql` schema and `DELIVERY_ENCRYPTION_KEY` (base64 for 32 cryptographically random bytes). The existing production database migration has already been applied; do not rerun it there. Never put the encryption key or courier API key in Git

**Barcode scanning and POS payments**
- Scan products with a USB or Bluetooth barcode scanner (acts like a keyboard) or the phone camera. The product SKU is the barcode, so scanning adds the item to the Multi Sale cart
- Unknown barcode opens a quick add form (with an optional name lookup from Open Food Facts) and the new product goes straight into the cart
- Charge screen with Cash, Card POS, Transfer, Mixed, and Credit. Mixed records any two or all three of POS, transfer, and cash; electronic portions require confirmation and the total must balance. Regular Card POS and Transfer can create pending sales held for 10 minutes and complete when payment is confirmed
- Moniepoint and OPay terminals: Denquva sends the total to the terminal and confirms by asking the provider directly (webhooks only speed it up). Without a connected terminal, one tap on Payment received confirms it
- Plain bank transfers confirm by themselves: a phone SMS forwarder app posts the bank alert to a private address from Settings, and Denquva confirms only when exactly one open transfer sale matches the credited amount (bank alert emails through Cloudflare Email Routing are an optional alternative)
- Held sales ("Awaiting payment"), paid sales are recorded even if the screen was closed, receipts to print or share on WhatsApp, and printable Code 128 barcode labels for products without a barcode

**Landing page and accounts**
- Public landing page that explains what Denquva does, how it works, and its main features, with Create Account and Log In buttons
- New visitors see the landing page once. Returning visitors go straight to login, and signed in users go straight to the dashboard
- Registration with shop name, email, password, and a security question for password recovery
- Cloudflare Turnstile human check on registration, verified on the server before an account is created
- Required, unchecked agreement to the Terms of Service and Privacy Policy, with links to both
- Acceptance is recorded with each account (time and terms version) by the Worker
- Persistent login sessions, with automatic logout when a session is no longer valid
- Password reset through the account email and security question, with optional one-time recovery codes
- Multi shop and branch support under one account, each shop with its own products, sales, and settings
- Owners can assign staff to specific shops and revoke access; staff can log out from the mobile header
- Quarterly Paystack subscription billing with a 7 day trial

**Inventory**
- Products, stock levels, prices, categories, and other product details
- Full stock movement audit trail, with every stock change recorded

**Sales**
- Multi Sale: build a cart with multiple products, quantity controls, and frequently sold quick add suggestions
- Complete sale details including unit price, cost, profit, and exact time
- Sales history with filters for Today / This week / This month / All
- Revenue and profit totals

**Credit Sales**
- Record customers, products purchased on credit, discounts, and purchase dates
- Stock updates immediately while payment remains Pending until settled
- Mark multiple pending credit sales as Paid at once
- Payments are recorded in sales and revenue totals on the date they are actually paid
- Search, filter, sort, and view complete credit sale details

**Debts**
- Record people and suppliers the business owes, with the amount, a note, the date owed, and an optional due date
- Record part or full payments, each kept in a payment history, with the balance updated automatically
- Total owed, overdue amount, search, filters (All, Owing, Settled), and sorting
- Kept separate from sales, stock, revenue, and profit, and removed with the account when it is deleted

**AI Business Assistant**
- Read only: answers questions about dashboard data, sales, top products, credit sales, and debts
- Does not modify inventory, prices, sales, or other business data
- Reads uploaded receipts and invoices from photos or files
- Remembers uploaded receipt information for future questions
- Voice input with transcription and AI responses

**Data Import**
- Bulk CSV and Excel import for products, sales, and stock
- Existing products can be updated through SKU or name matching instead of creating duplicates
- Smart import supports different column layouts, and AI maps imported columns to Denquva fields
- Review imported data before saving
- Multiple files can be imported and processed individually

**Other**
- Nigerian Naira (₦) by default, with configurable currency
- Installable Progressive Web App with offline support and add to home screen
- SEO with canonical URL, sitemap, robots.txt, and structured data
- CodeVent Digital attribution as the company behind Denquva

## Stack

- **Frontend:** Vanilla JavaScript, HTML, Tailwind CSS
- **Backend:** Cloudflare Workers
- **Database:** Cloudflare D1
- **Human verification:** Cloudflare Turnstile
- **AI:** Google Gemini API
- **Payments:** Paystack
- **PWA:** Service worker with offline caching and cache versioning

No frontend framework, no Node.js backend, and no external database service.

## Project structure

```text
denquva/
├── index.html              App shell, metadata, canonical and SEO tags
├── service-worker.js       Offline caching (bump CACHE_NAME on every release)
├── manifest.json           PWA manifest
├── delivery.html           Public customer delivery request and tracking page
├── css/
│   ├── tailwind.css
│   ├── app.css
│   └── hardware-pos.css
├── js/
│   ├── app.js              Application logic and UI
│   ├── pos.js              Checkout, barcode scanning, payment flows, and receipts
│   ├── hardware-pos.js     Register, printer, and drawer support
│   ├── extras.js           Staff, activity, backup, and supporting features
│   ├── reverse.js          Sale reversals
│   ├── delivery.js         Owner delivery tools
│   └── delivery-public.js  Customer delivery page logic
├── migrations/
│   ├── 20261017_delivery.sql
│   ├── hardware-pos.sql
│   ├── hardware-pos-discounts.sql
│   └── hardware-pos-shifts.sql
├── server/worker.js        Canonical complete Worker source
├── worker.js               Full-file mirror for Cloudflare dashboard deployments
└── tests/                  Node smoke checks for Worker and app behavior
```

`server/worker.js` is the canonical Worker source. The root `worker.js` is kept identical for Cloudflare dashboard deployments; the smoke tests check that they stay in sync. The live Worker bindings and secrets are managed in Cloudflare, not in this repository.

## How sign in works

1. A visitor with no saved session sees the landing page (first visit) or the login screen (returning).
2. Registration needs a valid email, a password of 6 or more characters, a shop name, a security question and answer, a ticked Terms box, and a passed Turnstile check.
3. The Worker verifies the Turnstile token with Cloudflare, checks that the terms were accepted, then creates the account and stores the acceptance time and version.
4. The Worker returns a signed token that the app keeps on the device. Every API call sends it as a Bearer token, and every `/api` route rejects requests without a valid one.
5. A session ends on logout, when the server answers 401, or after 30 days without activity.

## Deployment and operations

- **Pages:** publish the merged `main` branch through the existing Cloudflare Pages connection.
- **Worker:** deploy the complete `server/worker.js` source to the existing `denquva-api` Worker. The root `worker.js` mirror is identical. Do not paste only selected function blocks into the live Worker.
- **D1:** the production database already has the delivery, POS, discount, and register-shift schema described in `migrations/README.md`. Do not rerun one-time `ALTER TABLE` migrations against it. For any new D1 database, inspect its schema and follow the migration notes before deployment.
- **Secrets:** configure `JWT_SECRET`, `TURNSTILE_SECRET_KEY`, `AI_API_KEY`, `PAYSTACK_SECRET_KEY`, `PAYSTACK_PLAN_CODE`, and `DELIVERY_ENCRYPTION_KEY` in Cloudflare as applicable. Never commit secret values. Provider credentials for POS and EasyPost are configured per shop inside the app.
- **Readiness:** while signed in as the owner, open `/api/x/health` on the API Worker to check database tables and configured integrations. A ready flag means configuration is present; it does not prove a live provider transaction will succeed.
- **Local checks:** with Node.js 22 or newer, run `node tests/hardware-pos-smoke.mjs` and `node tests/business-insights-smoke.mjs`.

## Checking a release

1. Open the site in a private window. The landing page shows with Create Account and Log In.
2. Try to register without the Terms box ticked. It must refuse.
3. Register with the box ticked and Turnstile passed. You land on the dashboard.
4. Refresh. You stay signed in.
5. Log out. You see the login screen, not the landing page. Log back in.
6. Log in with an older account and confirm its products and sales are intact.
7. Check the authenticated owner health endpoint and verify any enabled external payment or courier integration with its provider's test mode before relying on it for live transactions.

## Notes

- When the Terms or Privacy Policy text changes, update `TERMS_VERSION` in `js/app.js`.
- Bump `CACHE_NAME` in `service-worker.js` after every frontend change so installed apps update.
- Sample data mode is off (`USE_SAMPLE_DATA = false`).

Built by [CodeVent Digital](https://codeventdigital.site).


