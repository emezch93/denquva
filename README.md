# Denquva

Denquva helps business owners manage products, inventory, sales, profit, customer credit, debts, and multiple shops in one place, with AI powered business assistance.

**Live app:** https://denquva.pages.dev

## What it does

**Reverse a sale**
- A sale made by mistake can be reversed from three places: the **Reverse this sale** button on a sale's details (Sales page), the **Sold the wrong item? Reverse this sale** link on the receipt, and an **Undo** bar that shows for a few seconds after a single sale
- The sale is removed from sales, revenue, profit, the dashboard, reports and the AI. A full copy is kept in `sale_reversals` with the reason and the time
- The items go back into stock by default. The owner can untick **Put the items back in stock** (for example for an imported sale that never took stock). The stock history gets a "Sale #N reversed" entry
- **Sales, Reversed** lists every reversed sale. Reversing the same sale twice, or at the same moment from two screens, only ever happens once
- Money is never sent back by Denquva. The screen reminds the owner to refund a customer who already paid by card or transfer

**Barcode scanning and POS payments**
- Scan products with a USB or Bluetooth barcode scanner (acts like a keyboard) or the phone camera. The product SKU is the barcode, so scanning adds the item to the Multi Sale cart
- Unknown barcode opens a quick add form (with an optional name lookup from Open Food Facts) and the new product goes straight into the cart
- Charge screen with Cash, Card POS, Transfer, and Credit. Cash and Credit finish at once. Card and Transfer create a pending sale held for 10 minutes and complete by themselves when the payment is confirmed
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
- Password reset through security questions
- Multi shop and branch support under one account, each shop with its own products, sales, and settings
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
├── robots.txt
├── sitemap.xml
├── tailwind.config.js      Tailwind configuration
├── css/
│   ├── tailwind.css        Compiled Tailwind output
│   └── app.css             Custom styles, including the landing page
├── js/
│   ├── app.js              Application logic, auth screens, and UI rendering
│   ├── pos.js              Barcode scanning, charge and payment flow, receipts, labels, POS settings
│   └── reverse.js          Reverse a sale: confirm sheet, Undo bar
├── icons/                  PWA icons
├── migrations/
│   ├── terms_acceptance.sql   Adds terms acceptance columns to the shops table
│   ├── debts.sql              Creates the debts and debt_payments tables
│   ├── pos.sql                Creates pos_integrations, pending_sales, and payment_events
│   └── sale_reversals.sql     Creates sale_reversals (records of reversed sales)
└── worker/
    ├── signup-block.js     Signup function with Turnstile and terms checks (for worker.js)
    └── pos-block.js        POS payments, Moniepoint and OPay, webhooks, alert emails (paste into worker.js)
```

See DEPLOY.md for the step by step POS and barcode setup.

The Worker itself (`worker.js`) lives in Cloudflare and is edited there.

## How sign in works

1. A visitor with no saved session sees the landing page (first visit) or the login screen (returning).
2. Registration needs a valid email, a password of 6 or more characters, a shop name, a security question and answer, a ticked Terms box, and a passed Turnstile check.
3. The Worker verifies the Turnstile token with Cloudflare, checks that the terms were accepted, then creates the account and stores the acceptance time and version.
4. The Worker returns a signed token that the app keeps on the device. Every API call sends it as a Bearer token, and every `/api` route rejects requests without a valid one.
5. A session ends on logout, when the server answers 401, or after 30 days without activity.

## Setup

Everything can be done in the Cloudflare dashboard.

**1. Turnstile**
- Turnstile, Add widget, hostname `denquva.pages.dev`, mode Managed
- Put the **Site Key** (public) in `TURNSTILE_SITE_KEY` at the top of `js/app.js`
- Keep the **Secret Key** private

**2. Worker secret**
- Workers and Pages, your API Worker, Settings, Variables and Secrets
- Add a Secret named `TURNSTILE_SECRET_KEY` with the Secret Key as its value
- The secret is never placed in the frontend or in this repo

**3. Database**
- D1, your database, Console, run the two statements in `migrations/terms_acceptance.sql` one at a time
- Existing accounts keep empty values in the new columns
- For the Debts page, also run each statement in `migrations/debts.sql` one at a time. Run them before deploying the Worker.

**4. Worker code**
- In the Worker's Edit code view, replace the old `signup` function with the contents of `worker/signup-block.js`, then Deploy

**4a. Reverse a sale**
- In the D1 Console run each statement in `migrations/sale_reversals.sql` one at a time, then deploy the updated `worker.js`

**4b. POS and barcode (optional but recommended)**
- Follow `DEPLOY.md`. It adds the `migrations/pos.sql` tables and pastes `worker/pos-block.js` into the Worker

**5. Website**
- Set `TURNSTILE_SITE_KEY` in `js/app.js`, then upload the site files in Workers and Pages, your Pages project, Create deployment

Other Worker variables already in use: `JWT_SECRET`, `AI_API_KEY`, `PAYSTACK_SECRET_KEY`, `PAYSTACK_PLAN_CODE`, and optionally `FRONTEND_URL`.

## Checking a release

1. Open the site in a private window. The landing page shows with Create Account and Log In.
2. Try to register without the Terms box ticked. It must refuse.
3. Register with the box ticked and Turnstile passed. You land on the dashboard.
4. Refresh. You stay signed in.
5. Log out. You see the login screen, not the landing page. Log back in.
6. Log in with an older account and confirm its products and sales are intact.
7. Confirm acceptance was saved:
   `SELECT email, terms_accepted_at, terms_version FROM shops ORDER BY id DESC LIMIT 5;`

## Notes

- When the Terms or Privacy Policy text changes, update `TERMS_VERSION` in `js/app.js`.
- Bump `CACHE_NAME` in `service-worker.js` after every frontend change so installed apps update.
- Sample data mode is off (`USE_SAMPLE_DATA = false`).

Built by [CodeVent Digital](https://codeventdigital.site).
