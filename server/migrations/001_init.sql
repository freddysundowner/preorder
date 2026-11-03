-- Preorder system: initial schema

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT,
  phone         TEXT NOT NULL UNIQUE,          -- normalised 2547XXXXXXXX
  email         TEXT,
  role          TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','staff','admin')),
  sms_opt_in    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id          SERIAL PRIMARY KEY,
  phone       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  attempts    INT NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS otp_phone_idx ON otp_codes(phone);

-- A shipping period (batch). Its status moves the whole batch.
CREATE TABLE IF NOT EXISTS shipping_periods (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  opens_at    TIMESTAMPTZ NOT NULL,
  closes_at   TIMESTAMPTZ NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                'draft','open','closed','supplier_dispatching','warehouse_received',
                'in_transit','ready_for_collection','completed')),
  eta_date    DATE,
  reminder_sent_at TIMESTAMPTZ,
  announced_at TIMESTAMPTZ,
  created_by  INT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id          SERIAL PRIMARY KEY,
  period_id   INT NOT NULL REFERENCES shipping_periods(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  price_kes   INT NOT NULL CHECK (price_kes > 0),
  image_url   TEXT,
  min_qty     INT,                 -- supplier minimum (total across all orders)
  max_qty     INT,                 -- max per customer order
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS products_period_idx ON products(period_id);

CREATE TABLE IF NOT EXISTS cart_items (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id  INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty         INT NOT NULL CHECK (qty > 0),
  UNIQUE (user_id, product_id)
);

CREATE SEQUENCE IF NOT EXISTS order_no_seq START 1001;

CREATE TABLE IF NOT EXISTS orders (
  id              SERIAL PRIMARY KEY,
  order_no        TEXT NOT NULL UNIQUE,     -- also the invoice / Paybill account number
  user_id         INT NOT NULL REFERENCES users(id),
  period_id       INT NOT NULL REFERENCES shipping_periods(id),
  total_kes       INT NOT NULL,
  paid_kes        INT NOT NULL DEFAULT 0,
  refund_due_kes  INT NOT NULL DEFAULT 0,
  payment_status  TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN (
                    'unpaid','paid','cancelled','refund_pending','refunded')),
  pickup_code_hash TEXT,
  collected_at    TIMESTAMPTZ,
  collected_by_name  TEXT,
  collected_by_phone TEXT,
  released_by     INT REFERENCES users(id),
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_user_idx ON orders(user_id);
CREATE INDEX IF NOT EXISTS orders_period_idx ON orders(period_id);

CREATE TABLE IF NOT EXISTS order_items (
  id              SERIAL PRIMARY KEY,
  order_id        INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id      INT NOT NULL REFERENCES products(id),
  product_name    TEXT NOT NULL,
  qty             INT NOT NULL,
  unit_price_kes  INT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled'))
);

CREATE TABLE IF NOT EXISTS payments (
  id                  SERIAL PRIMARY KEY,
  order_id            INT REFERENCES orders(id),
  method              TEXT NOT NULL CHECK (method IN ('stk','paybill','manual')),
  checkout_request_id TEXT UNIQUE,
  mpesa_receipt       TEXT UNIQUE,
  phone               TEXT,
  amount_kes          INT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                        'pending','approved','failed','rejected','unmatched')),
  result_desc         TEXT,
  raw_callback        JSONB,
  approved_by         INT REFERENCES users(id),
  approved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_order_idx ON payments(order_id);

CREATE TABLE IF NOT EXISTS status_events (
  id          SERIAL PRIMARY KEY,
  period_id   INT NOT NULL REFERENCES shipping_periods(id) ON DELETE CASCADE,
  status      TEXT NOT NULL,
  note        TEXT,
  eta_date    DATE,
  created_by  INT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proposed_items (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT,
  image_url     TEXT,
  est_price_kes INT,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS interests (
  id               SERIAL PRIMARY KEY,
  proposed_item_id INT NOT NULL REFERENCES proposed_items(id) ON DELETE CASCADE,
  user_id          INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  qty              INT NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (proposed_item_id, user_id)
);

CREATE TABLE IF NOT EXISTS sms_messages (
  id          SERIAL PRIMARY KEY,
  user_id     INT REFERENCES users(id),
  phone       TEXT NOT NULL,
  template    TEXT NOT NULL,
  body        TEXT NOT NULL,
  provider_id TEXT,
  status      TEXT NOT NULL DEFAULT 'queued',
  cost        TEXT,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sms_provider_idx ON sms_messages(provider_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id          SERIAL PRIMARY KEY,
  actor_id    INT REFERENCES users(id),
  action      TEXT NOT NULL,
  entity      TEXT,
  entity_id   TEXT,
  data        JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
