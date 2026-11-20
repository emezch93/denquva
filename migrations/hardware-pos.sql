-- Run once against the existing D1 database before deploying the updated Worker.
-- Adds non-authoritative register/device attribution without changing checkout totals.
ALTER TABLE sales ADD COLUMN terminal_id TEXT;
ALTER TABLE pending_sales ADD COLUMN device_terminal_id TEXT;
CREATE INDEX IF NOT EXISTS idx_sales_shop_terminal ON sales(shop_id, terminal_id);
CREATE INDEX IF NOT EXISTS idx_pending_sales_shop_device_terminal ON pending_sales(shop_id, device_terminal_id);
