ALTER TABLE products ADD COLUMN reserved_quantity INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN delivery_order_id TEXT;

CREATE TABLE delivery_settings (
  shop_id INTEGER PRIMARY KEY,
  public_slug TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  origin_address TEXT NOT NULL DEFAULT '{}',
  flat_delivery_fee REAL NOT NULL DEFAULT 0 CHECK (flat_delivery_fee >= 0),
  easypost_api_key_ciphertext TEXT NOT NULL DEFAULT '',
  easypost_webhook_secret_ciphertext TEXT NOT NULL DEFAULT '',
  easypost_webhook_id TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
);

CREATE TABLE delivery_orders (
  id TEXT PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  public_tracking_hash TEXT NOT NULL UNIQUE,
  request_ip_hash TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT NOT NULL DEFAULT '',
  country_code TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT '',
  locality TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL DEFAULT '',
  address_line1 TEXT NOT NULL,
  address_line2 TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  delivery_instructions TEXT NOT NULL DEFAULT '',
  delivery_method TEXT NOT NULL DEFAULT '',
  courier_provider TEXT NOT NULL DEFAULT '',
  courier_shipment_id TEXT NOT NULL DEFAULT '',
  courier_tracking_code TEXT NOT NULL DEFAULT '',
  courier_tracking_url TEXT NOT NULL DEFAULT '',
  courier_label_url TEXT NOT NULL DEFAULT '',
  courier_rates_json TEXT NOT NULL DEFAULT '[]',
  driver_staff_id INTEGER,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'accepted', 'ready', 'in_transit', 'delivered', 'rejected', 'cancelled', 'failed', 'returned')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid', 'refunded')),
  payment_method TEXT NOT NULL DEFAULT '',
  currency_code TEXT NOT NULL,
  subtotal REAL NOT NULL,
  delivery_fee REAL NOT NULL DEFAULT 0,
  total_amount REAL NOT NULL,
  customer_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  accepted_at TEXT,
  delivered_at TEXT,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  FOREIGN KEY (driver_staff_id) REFERENCES x_staff(id) ON DELETE SET NULL,
  UNIQUE (shop_id, idempotency_key)
);

CREATE TABLE delivery_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  shop_id INTEGER NOT NULL,
  product_id INTEGER,
  product_name TEXT NOT NULL,
  sku TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price REAL NOT NULL,
  unit_cost REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL,
  reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved IN (0, 1)),
  FOREIGN KEY (order_id) REFERENCES delivery_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
  UNIQUE (order_id, product_id)
);

CREATE TABLE delivery_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  shop_id INTEGER NOT NULL,
  event_key TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  provider_event_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (order_id) REFERENCES delivery_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  UNIQUE (shop_id, event_key),
  UNIQUE (provider_event_id)
);

CREATE TABLE delivery_locations (
  order_id TEXT PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  latitude REAL NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
  longitude REAL NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
  accuracy_m REAL NOT NULL DEFAULT 0,
  captured_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (order_id) REFERENCES delivery_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
);

CREATE TABLE delivery_transaction_assertions (
  assertion_key TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK (ok = 1)
);

CREATE INDEX idx_delivery_orders_shop_status ON delivery_orders(shop_id, status, created_at DESC);
CREATE INDEX idx_delivery_orders_courier ON delivery_orders(courier_provider, courier_shipment_id);
CREATE INDEX idx_delivery_order_items_order ON delivery_order_items(order_id, shop_id);
CREATE INDEX idx_delivery_events_order ON delivery_events(order_id, created_at DESC);
CREATE INDEX idx_delivery_events_provider ON delivery_events(provider_event_id);
CREATE INDEX idx_delivery_orders_request_rate ON delivery_orders(request_ip_hash, created_at);
CREATE UNIQUE INDEX idx_sales_delivery_product ON sales(delivery_order_id, product_id) WHERE delivery_order_id IS NOT NULL;

CREATE TRIGGER delivery_prevent_stock_below_reservations
BEFORE UPDATE OF quantity ON products
WHEN NEW.quantity < NEW.reserved_quantity
BEGIN
  SELECT RAISE(ABORT, 'Stock quantity cannot be lower than reserved delivery stock');
END;

