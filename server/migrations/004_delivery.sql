-- Each order is either collected at the shop with a pickup code, or delivered to the customer.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfilment TEXT NOT NULL DEFAULT 'pickup'
  CHECK (fulfilment IN ('pickup', 'delivery'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_phone TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_fee_kes INT NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
