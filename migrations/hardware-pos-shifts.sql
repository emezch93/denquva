-- Apply after hardware-pos.sql and hardware-pos-discounts.sql. Additive, preserves existing rows.
-- Existing sales keep NULL payment_method because their original tender is not reliably known.
ALTER TABLE sales ADD COLUMN payment_method TEXT;
ALTER TABLE sale_reversals ADD COLUMN terminal_id TEXT;
ALTER TABLE sale_reversals ADD COLUMN payment_method TEXT;
ALTER TABLE sale_reversals ADD COLUMN reversed_at TEXT;

CREATE TABLE pos_shifts (
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
CREATE INDEX idx_pos_shifts_shop_opened ON pos_shifts(shop_id, opened_at DESC);
CREATE INDEX idx_pos_shifts_terminal_open ON pos_shifts(shop_id, terminal_id, status);
CREATE UNIQUE INDEX idx_pos_shifts_one_open_terminal ON pos_shifts(shop_id, terminal_id) WHERE status='open';
