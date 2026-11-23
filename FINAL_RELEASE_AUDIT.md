# Denquva release audit

## Scope

Reviewed the repository at the merge of PR #22 (`99b899bc1c5f72bad6ab26f2f804a99c89c6d701`) and the follow-up audit fixes in this branch. The review covered the POS checkout and payment ledger, Worker/API handling, D1 schema assumptions and migrations, staff/shop flows, delivery and courier paths, subscriptions, AI, password recovery, service-worker updates, and deployment documentation.

## Findings corrected

- The GitHub repository's canonical Worker is `server/worker.js`; a local root `worker.js` copy is not tracked and is not the deployment source. Deployment docs and tests now use the canonical path.
- Offline cash sales do not depend on POS provider setup. Retryable sync failures now display the actual reason (including expired login or inactive subscription), retain the sale, back off retries, and allow an explicit retry after the account issue is corrected.
- Schema initialization cached an in-flight D1 promise in module scope. Concurrent requests could await the same request-bound I/O. It now caches only a boolean after successful initialization; all schema statements use `IF NOT EXISTS`, and the smoke test covers concurrent first calls.
- The delivery deployment guide pointed at a nonexistent `outputs/worker.js`, and README setup instructions referenced missing deployment scripts and migrations. The docs now point to the real complete Worker files and warn against rerunning production migrations.
- Checkout and staff feature fallbacks also referred users to a missing `DEPLOY.md` and migrations that are not in this repository. Those messages now point to the current Worker source and schema notes.
- The current Mixed checkout accepts any two or all three of POS, transfer, and cash. It requires completion/verification for non-cash portions, balances the total in integer cents, saves the sale and stock change in one D1 batch, and records each tender portion for receipts and shift reconciliation.

## Automated checks

- `node --check` passed for every file in `js/`, `server/worker.js`, and `service-worker.js`.
- `node tests/hardware-pos-smoke.mjs` passed, including concurrent schema initialization, three-method allocation, invalid and duplicate tender rejection, stock safety, UI confirmation rules, and mixed cash shift/reversal calculations.
- `node tests/business-insights-smoke.mjs` passed.
- No additional D1 migration is required for Mixed checkout or these audit fixes.

## Production checks still required

This repository has no Wrangler configuration, package manifest, or Cloudflare runtime test harness. The local tests use Node and a D1-like SQLite mock; they do not prove the deployed Worker, D1 binding, or external providers are healthy. This audit did not access the live Cloudflare environment or perform transactions with provider credentials or physical devices.

Before treating the release as operationally closed:

1. Deploy the complete `server/worker.js` source to the existing `denquva-api` Worker. Do not rerun the existing production D1 migrations.
2. Publish the merged Pages build and check `/api/x/health` while signed in as the owner.
3. Run a small test transaction for each enabled provider: Paystack subscription flow, Moniepoint/OPay terminal flow, bank transfer confirmation, EasyPost test shipment/webhook, and Gemini AI. Confirm Turnstile works on account creation and public delivery requests.
4. Test Mixed checkout on the actual desktop/mobile devices used by the shop, including reversal and register shift close. Confirm any card portion on the physical terminal and any transfer portion in the bank first.

Cloudflare account secrets, provider accounts, carrier availability, browser permissions, and physical printer/drawer behavior cannot be inferred from source code or these automated checks.

