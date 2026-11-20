-- Apply after hardware-pos.sql. Adds reversible sale discount metadata only.
ALTER TABLE sales ADD COLUMN subtotal_amount REAL;
ALTER TABLE sales ADD COLUMN discount_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE sale_reversals ADD COLUMN subtotal_amount REAL;
ALTER TABLE sale_reversals ADD COLUMN discount_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE pending_sales ADD COLUMN discount_kobo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pending_sales ADD COLUMN discount_percent REAL NOT NULL DEFAULT 0;
