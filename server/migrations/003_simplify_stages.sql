-- Simplify the shipping flow: Draft is gone (a new round is simply Open from its opening time),
-- and "Supplier dispatching / Received at warehouse / In transit" become one "On the way" stage.
ALTER TABLE shipping_periods DROP CONSTRAINT IF EXISTS shipping_periods_status_check;

UPDATE shipping_periods SET status = 'open' WHERE status = 'draft';
UPDATE shipping_periods SET status = 'in_transit' WHERE status IN ('supplier_dispatching', 'warehouse_received');
UPDATE status_events SET status = 'in_transit' WHERE status IN ('supplier_dispatching', 'warehouse_received');
UPDATE status_events SET status = 'open' WHERE status = 'draft';

ALTER TABLE shipping_periods ALTER COLUMN status SET DEFAULT 'open';
ALTER TABLE shipping_periods ADD CONSTRAINT shipping_periods_status_check
  CHECK (status IN ('open','closed','in_transit','ready_for_collection','completed'));
