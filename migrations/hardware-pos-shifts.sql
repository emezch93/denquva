-- POS shift and tender attribution migration for the Denquva D1 schema.
-- The live database already has sales.terminal_id, pending_sales.device_terminal_id,
-- both discount column sets, and sale_reversals.reversed_at. This migration intentionally
-- does not add those existing columns again.
-- Run once only if the payment_method columns and pos_shifts table are still absent.
CREATE INDEX IF NOT EXISTS idx_sales_shop_terminal
  ON sales(shop_id, terminal_id);
CREATE INDEX IF NOT EXISTS idx_pending_sales_shop_device_terminal
  ON pending_sales(shop_id, device_terminal_id);

ALTER TABLE sales ADD COLUMN payment_method TEXT;
ALTER TABLE sale_reversals ADD COLUMN terminal_id TEXT;
ALTER TABLE sale_reversals ADD COLUMN payment_method TEXT;

CREATE TABLE IF NOT EXISTS pos_shifts (
  id TEXT PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  terminal_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  role TEXT NOT NULL,
  opening_cash REAL NOT NULL DEFAULT 0,
  closing_cash REAL,
  expected_cash REAL,
  variance REAL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_pos_shifts_shop_opened ON pos_shifts(shop_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_shifts_terminal_open ON pos_shifts(shop_id, terminal_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_shifts_one_open_terminal ON pos_shifts(shop_id, terminal_id) WHERE status='open';
