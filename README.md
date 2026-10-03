# Denquva

Denquva is a business management platform that helps businesses manage products, inventory, sales, profit, customer credit, and multiple shops in one place, with AI powered business assistance.

**Live app:** https://denquva.pages.dev

## What it does

**Inventory**
- Manage products, stock levels, prices, categories, and other product details
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

**AI Business Assistant**
- Read only: answers questions about dashboard data, sales, top products, and credit sales
- Does not modify inventory, prices, sales, or other business data
- Reads uploaded receipts and invoices from photos or files
- Remembers uploaded receipt information for future questions
- Voice input with transcription and AI responses

**Data Import**
- Bulk CSV and Excel import for products, sales, and stock
- Existing products can be updated through SKU or name matching instead of creating duplicates
- Smart import supports different column layouts
- AI maps imported columns to Denquva fields
- Review imported data before saving
- Multiple files can be imported and processed individually

**Accounts & Billing**
- User signup and login
- Password reset through security questions
- Multi shop and branch support under one account
- Each shop has its own products, sales, and settings
- Quarterly Paystack subscription billing
- Trial period
- Settings page reflects current subscription status

**Other**
- Nigerian Naira (₦) by default, with configurable currency
- Installable Progressive Web App
- Offline support
- Add to home screen
- SEO with canonical URL, sitemap, robots.txt, and structured data
- CodeVent Digital attribution as the company behind Denquva

## Stack

- **Frontend:** Vanilla JavaScript, HTML, Tailwind CSS
- **Backend:** Cloudflare Workers
- **Database:** Cloudflare D1
- **AI:** Google Gemini API
- **Payments:** Paystack
- **PWA:** Service worker with offline caching and cache versioning

No frontend framework, no Node.js backend, and no external database service.

## Project Structure

```text
denquva/
├── index.html              App shell, metadata, canonical and SEO tags
├── service-worker.js       Offline caching
├── manifest.json           PWA manifest
├── robots.txt
├── sitemap.xml
├── tailwind.config.js      Tailwind configuration
├── migrations/
│   └── credit_sales.sql    D1 migration
├── css/
│   ├── tailwind.css        Compiled Tailwind output
│   └── app.css             Custom styles
├── js/
│   └── app.js              Application logic and UI rendering
└── icons/                  PWA icons
