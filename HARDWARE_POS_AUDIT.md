# Denquva POS hardware audit implementation

This audit note describes the merged Counter POS and hardware support. Follow `FINAL_RELEASE_AUDIT.md` for the current repository-wide review and validation status.

## Implemented

- Added a Counter POS screen to the existing navigation. It uses the app's current product APIs, sale cart, payment chooser, cash/card/transfer/credit flows, and stock validation.
- Added a touch-friendly responsive layout for desktop and small Android screens.
- Added product search/tap entry, existing camera scanning, barcode input, rapid keyboard-wedge scanner detection, near-simultaneous duplicate suppression, and existing unknown-barcode quick-add flow.
- Reused existing Moniepoint and OPay payment integration and payment verification.
- Added per-shop, per-browser terminal IDs. The Worker stores IDs with completed sales and pending electronic sales. This is attribution metadata, not an authentication credential.
- Added 58/80 mm ESC/POS text receipts with shop, date/time, items, currency code, total, method and reference. Existing browser printing remains the fallback. Added WebUSB and Web Serial adapters with feature checks and connection/error states.
- Added an explicit owner-only cash-drawer pulse test. The UI asks for confirmation and reports the command as sent only after the browser adapter resolves.
- Mirrored the existing cash-only offline queue to IndexedDB while retaining its localStorage records and Worker replay reference. Electronic payments still require online confirmation.
- Bumped the service-worker shell cache and included the new script and CSS.

No new paid service or third-party runtime dependency was added.

## D1 migration

The D1 database already contained the terminal and discount columns. Those earlier migrations must not be rerun on this database. The corrected shift/tender SQL was applied after inspecting the live schema; see migrations/README.md.

Do not rerun these one-time migration files against the configured production database. Inspect each target D1 schema before applying migrations.

The production D1 shift migration was applied after correcting it to match the inspected schema. The SQL was also exercised against a local SQLite database.

## Validation run

Reproducible checks are in tests/hardware-pos-smoke.mjs. Run them with Node 22 or newer:

    node tests/hardware-pos-smoke.mjs

Checks cover all three D1 migrations, Worker-origin shift list/open/close requests, terminal ID validation and shop separation, cash-versus-electronic shift reconciliation SQL, one-open-shift-per-register constraint, barcode quantity increments, unknown barcode quick-add routing, HTML escaping, receipt contents, serial byte transmission mock, printer cleanup, Worker sale discount/tender calculations, stock deduction, terminal attribution, and cross-shop product isolation. JavaScript files were syntax-checked.

## Remaining checks and limits

- No physical printer, drawer, barcode scanner, Android Smart POS, Firefox, Safari, or live browser session was available. WebUSB/Web Serial capability or a successful write call does not prove paper printed or a drawer physically opened. Test with the exact equipment.
- Web Serial/USB availability varies by browser, operating system, Android build, device firmware, permissions and printer interface. Browser print remains the fallback. The app does not include a paid/local print bridge.
- No Moniepoint Android SDK or restricted vendor API was added; existing backend payment-terminal requests are reused.
- Offline sales remain cash-only. IndexedDB/local persistence and the existing Worker replay key reduce loss and duplicate retries, but disconnected terminals cannot coordinate stock or prevent total offline overselling.
- Added owner-only percentage discounts to the Counter POS cash and electronic-payment flows. Authorization is derived in the Worker from the authenticated role; staff can only finalize an owner-created pending discounted payment. The Worker records subtotal and discount metadata on sales/reversals, charges the discounted amount, and calculates profit against discounted revenue. Existing credit-sale discount behavior remains separate.
- Added register shifts with opening and closing cash counts, one open shift per shop/register, authenticated staff/owner close permissions, cash-only expected drawer reconciliation, and reversal deductions.
- Added register filtering to the existing Sales view. Sales now retain tender method metadata for new Worker-recorded sales; historic tender methods remain NULL and are excluded from shift cash totals.
- Added a Mixed tender flow for any combination of POS, bank transfer, and cash. The Worker validates the total, saves stock and sales atomically, and allocates tender amounts to the payment ledger for cash reconciliation.
- Kept `worker.js` identical to the canonical `server/worker.js`; tests fail if these deployable copies drift.
- Added owner-configured automatic drawer pulse after an accepted cash checkout, keyed per local transaction to avoid duplicate pulses. It reports when no printer is connected. The setting is stored per shop and browser/device.
- Drawer operation is an explicit owner-only test action. Automatic drawer opening, cashier-level drawer permissions, customer receipt fields, shifts, and terminal-filtered reporting are not implemented.
- This smoke suite is not a substitute for the absent full browser/API test suite or physical-hardware acceptance testing.

The application changes are merged. The complete Worker source is `server/worker.js`, with an identical root `worker.js` mirror for full-file dashboard deployment.

