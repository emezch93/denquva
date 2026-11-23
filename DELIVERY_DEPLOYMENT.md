# Delivery deployment

Delivery adds D1 tables and one `products` column. The production D1 schema was already migrated. Do not rerun the one-time production migration. For a different, newly created D1 database, inspect and migrate it once before deploying the Worker because sale stock checks account for delivery reservations.

## 1. Back up and migrate D1

For an existing database, first inspect `PRAGMA table_info(products);` and the delivery tables in the Cloudflare D1 console. The configured production database already has these changes, so skip this migration there. For a new database, inspect its schema, create a recoverable backup if it contains data, and apply `migrations/20261017_delivery.sql` once to the D1 database bound to the Worker. With Wrangler, use the actual database name from the existing Worker configuration:

```sh
npx wrangler d1 execute YOUR_DATABASE_NAME --remote --file=migrations/20261017_delivery.sql
```

Do not run this against a new or unrelated database. The migration is intended to run once; it adds `products.reserved_quantity` and `sales.delivery_order_id` and creates delivery tables, indexes, and the stock-reservation guard.

## 2. Set the Worker encryption secret

Generate a 32-byte random secret locally with Node.js:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Add the output as the `DELIVERY_ENCRYPTION_KEY` Worker secret in Cloudflare. Keep a secure backup of this value. It encrypts each shop's EasyPost API key and webhook secret in D1; losing it means those saved credentials must be reconnected. Do not put the value in source control or a plain-text config file.

## 3. Deploy

Deploy the complete canonical Worker source at `server/worker.js` to the existing `denquva-api` Worker. Then publish the merged Pages files from GitHub, including `delivery.html`, `js/delivery-public.js`, `js/delivery.js`, `service-worker.js`, and the updated `index.html`. Do not deploy a partial Worker block or replace the full app with delivery-only files.

## 4. Verify with a test EasyPost key

In the owner account, open Deliveries, enter the shop sender address, enable customer requests, and share the generated link. Connect an EasyPost test API key first. Submit a customer test request, accept it as own-driver or courier, and verify inventory is reserved (not yet sold). For own-driver delivery, allow location access on an HTTPS device and keep the delivery view open while testing. For courier delivery, enter the parcel's packed weight and dimensions, request live rates, and confirm the exact label price before buying. Verify the tracking page and status updates. Only mark successful delivery after handoff; this records the sale and consumes the reserved stock. Test cancel/reject/failure paths and verify reserved stock is released.

EasyPost coverage and rates vary by the carrier accounts enabled for the shop and by shipment origin/destination. Owner-driver delivery can be used independently of EasyPost. Device location sharing requires browser permission and an active page; mobile operating systems may suspend it in the background.

## Rollback note

Do not roll back only the Worker or static files while keeping the new Worker unavailable: delivery reservations participate in ordinary sale stock checks. If rolling back the app, keep a Worker version that understands `reserved_quantity` until all active deliveries are completed or cancelled. Do not drop the new database columns or tables as part of a routine code rollback.

