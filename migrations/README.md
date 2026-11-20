# D1 migration notes

The Worker source is tracked at `server/worker.js`. Credentials must be supplied through Cloudflare Worker secrets/bindings; do not commit `.env`, `.dev.vars`, private keys, or local Wrangler state. The root `.gitignore` excludes those local files.

## Existing Denquva D1 database

The configured production D1 database already has `sales.terminal_id`, `pending_sales.device_terminal_id`, sale discount columns, and `sale_reversals.reversed_at`. The register shift migration was applied with the corrected SQL on 2026-11-20. Do not rerun migrations 1, 2, or the shift migration on that database.

The files `hardware-pos.sql` and `hardware-pos-discounts.sql` document the earlier schema additions. Their `ALTER TABLE` statements are one-time operations and are not safe to repeat.

## New database setup

Inspect the target schema first with `PRAGMA table_info(table_name);`. Apply only the missing column statements, in order, then create missing indexes and the `pos_shifts` table. Do not assume a fresh or identical schema. D1 uses SQLite, and adding an existing column fails.

Never run these against production without checking its schema and a backup/restore path.
