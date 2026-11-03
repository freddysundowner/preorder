import { Router } from 'express';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { UPLOAD_DIR } from '../uploads.js';
import { one, many, query, tx, audit } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  setPeriodStatus, markDelivered, sendClosingReminder, cancelProduct, collectOrder, applyPayment, notifyPeriodOpened,
} from '../services/orders.js';
import { settingsForAdmin, saveSettings, callbackUrls } from '../services/settings.js';
import { sendSms } from '../services/sms.js';
import { sendEmail } from '../services/email.js';
import { registerC2bUrls } from '../services/mpesa.js';
import { orderDetail } from './shop.js';
import { ah, bad, notFound, int, normalizePhone, STAGES } from '../util.js';

const r = Router();
r.use(requireAuth);

const admin = requireRole();          // admin only
const staff = requireRole('staff');   // admin or shop staff

// ---------- Image upload ----------
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
r.post('/upload', admin, express.raw({ type: Object.keys(EXT), limit: '6mb' }), ah(async (req, res) => {
  const ext = EXT[req.headers['content-type']];
  if (!ext || !Buffer.isBuffer(req.body) || !req.body.length) throw bad('Upload a JPG, PNG, WebP or GIF image (max 6 MB)');
  const name = `${crypto.randomBytes(12).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), req.body);
  res.status(201).json({ url: `/uploads/${name}` });
}));

// ---------- Overview ----------
r.get('/overview', staff, ah(async (req, res) => {
  const open = await one(
    `SELECT * FROM shipping_periods WHERE status = 'open' ORDER BY closes_at LIMIT 1`
  );
  let openStats = null;
  if (open) {
    openStats = await one(
      `SELECT COUNT(*)::int AS orders,
              COUNT(*) FILTER (WHERE payment_status = 'paid')::int AS paid_orders,
              COUNT(*) FILTER (WHERE payment_status = 'unpaid')::int AS unpaid_orders,
              COALESCE(SUM(paid_kes) FILTER (WHERE payment_status IN ('paid','unpaid')),0)::int AS collected_kes,
              COALESCE(SUM(total_kes - paid_kes) FILTER (WHERE payment_status = 'unpaid'),0)::int AS outstanding_kes
         FROM orders WHERE period_id = $1`,
      [open.id]
    );
  }
  const counts = await one(
    `SELECT
       (SELECT COUNT(*)::int FROM payments WHERE status = 'unmatched') AS unmatched_payments,
       (SELECT COUNT(*)::int FROM orders WHERE payment_status = 'refund_pending') AS refunds_pending,
       (SELECT COUNT(*)::int FROM orders WHERE pickup_code_hash IS NOT NULL AND collected_at IS NULL AND payment_status = 'paid') AS awaiting_collection,
       (SELECT COUNT(*)::int FROM users WHERE role = 'customer') AS customers`
  );
  const shipping = await many(
    `SELECT p.id, p.name, p.status, p.eta_date,
            (SELECT COUNT(*)::int FROM orders o WHERE o.period_id = p.id AND o.payment_status = 'paid') AS paid_orders
       FROM shipping_periods p
      WHERE p.status NOT IN ('open','completed') ORDER BY p.closes_at DESC`
  );
  res.json({ open, openStats, counts, shipping });
}));

// ---------- Shipping periods ----------
r.get('/periods', admin, ah(async (req, res) => {
  const periods = await many(
    `SELECT p.*,
            (SELECT COUNT(*)::int FROM products pr WHERE pr.period_id = p.id AND pr.status = 'active') AS product_count,
            (SELECT COUNT(*)::int FROM orders o WHERE o.period_id = p.id) AS order_count,
            (SELECT COUNT(*)::int FROM orders o WHERE o.period_id = p.id AND o.payment_status = 'paid') AS paid_count,
            (SELECT COALESCE(SUM(o.total_kes),0)::int FROM orders o WHERE o.period_id = p.id AND o.payment_status = 'paid') AS paid_kes
       FROM shipping_periods p ORDER BY p.opens_at DESC`
  );
  res.json({ periods });
}));

function periodInput(b) {
  const name = String(b.name || '').trim();
  const opensAt = b.opens_at ? new Date(b.opens_at) : null;
  const closesAt = b.closes_at ? new Date(b.closes_at) : null;
  if (!name) throw bad('Give the period a name, e.g. "December shipment"');
  if (!opensAt || isNaN(opensAt) || !closesAt || isNaN(closesAt)) throw bad('Set the opening and closing dates');
  if (closesAt <= opensAt) throw bad('Closing date must be after the opening date');
  return { name, opensAt, closesAt, etaDate: b.eta_date || null };
}

r.post('/periods', admin, ah(async (req, res) => {
  const p = periodInput(req.body);
  const period = await one(
    `INSERT INTO shipping_periods (name, opens_at, closes_at, eta_date, created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [p.name, p.opensAt, p.closesAt, p.etaDate, req.user.id]
  );
  await audit(req.user.id, 'period.created', 'period', period.id, p);
  res.status(201).json({ period });
}));

r.get('/periods/:id', admin, ah(async (req, res) => {
  const id = int(req.params.id);
  const period = await one('SELECT * FROM shipping_periods WHERE id = $1', [id]);
  if (!period) throw notFound();
  const [products, events, stats] = await Promise.all([
    many(
      `SELECT pr.*,
              COALESCE((SELECT SUM(oi.qty) FROM order_items oi JOIN orders o ON o.id = oi.order_id
                         WHERE oi.product_id = pr.id AND oi.status = 'active' AND o.payment_status = 'paid'),0)::int AS paid_qty,
              COALESCE((SELECT SUM(oi.qty) FROM order_items oi JOIN orders o ON o.id = oi.order_id
                         WHERE oi.product_id = pr.id AND oi.status = 'active' AND o.payment_status = 'unpaid'),0)::int AS unpaid_qty
         FROM products pr WHERE pr.period_id = $1 ORDER BY pr.id`,
      [id]
    ),
    many(
      `SELECT e.*, u.name AS by_name FROM status_events e LEFT JOIN users u ON u.id = e.created_by
        WHERE e.period_id = $1 ORDER BY e.id DESC`,
      [id]
    ),
    one(
      `SELECT COUNT(*)::int AS orders,
              COUNT(*) FILTER (WHERE payment_status = 'paid')::int AS paid,
              COUNT(*) FILTER (WHERE payment_status = 'unpaid')::int AS unpaid,
              COUNT(*) FILTER (WHERE collected_at IS NOT NULL)::int AS collected,
              COALESCE(SUM(total_kes) FILTER (WHERE payment_status = 'paid'),0)::int AS paid_kes
         FROM orders WHERE period_id = $1`,
      [id]
    ),
  ]);
  res.json({ period, products, events, stats });
}));

r.patch('/periods/:id', admin, ah(async (req, res) => {
  const id = int(req.params.id);
  const cur = await one('SELECT * FROM shipping_periods WHERE id = $1', [id]);
  if (!cur) throw notFound();
  const p = periodInput({ ...cur, ...req.body });
  const period = await one(
    `UPDATE shipping_periods SET name = $2, opens_at = $3, closes_at = $4, eta_date = $5 WHERE id = $1 RETURNING *`,
    [id, p.name, p.opensAt, p.closesAt, p.etaDate]
  );
  await audit(req.user.id, 'period.updated', 'period', id, p);
  res.json({ period });
}));

r.post('/periods/:id/status', admin, ah(async (req, res) => {
  const { status, eta_date, note } = req.body;
  if (!STAGES.includes(status)) throw bad('Unknown status');
  const period = await setPeriodStatus(int(req.params.id), status, {
    etaDate: eta_date === undefined ? undefined : eta_date || null,
    note: note ? String(note).trim().slice(0, 160) : null,
    actorId: req.user.id,
  });
  res.json({ period });
}));

r.post('/periods/:id/remind', admin, ah(async (req, res) => {
  const period = await one(`SELECT * FROM shipping_periods WHERE id = $1 AND status = 'open'`, [int(req.params.id)]);
  if (!period) throw bad('Reminders can only be sent while a period is open');
  const sent = await sendClosingReminder(period.id);
  await audit(req.user.id, 'period.reminder', 'period', period.id, { sent });
  res.json({ sent });
}));

r.post('/periods/:id/announce', admin, ah(async (req, res) => {
  const period = await one(`SELECT * FROM shipping_periods WHERE id = $1 AND status = 'open'`, [int(req.params.id)]);
  if (!period) throw bad('Only open periods can be announced');
  await notifyPeriodOpened(period.id);
  await audit(req.user.id, 'period.announced', 'period', period.id);
  res.json({ ok: true });
}));

// Total quantity per product across paid orders: what to order from the supplier
r.get('/periods/:id/supplier-summary', admin, ah(async (req, res) => {
  const id = int(req.params.id);
  const period = await one('SELECT * FROM shipping_periods WHERE id = $1', [id]);
  if (!period) throw notFound();
  const rows = await many(
    `SELECT pr.id, pr.name, pr.price_kes, pr.min_qty, pr.status,
            COALESCE(SUM(oi.qty) FILTER (WHERE o.payment_status = 'paid'),0)::int AS qty,
            COALESCE(SUM(oi.qty * oi.unit_price_kes) FILTER (WHERE o.payment_status = 'paid'),0)::int AS value_kes,
            COUNT(DISTINCT o.id) FILTER (WHERE o.payment_status = 'paid')::int AS orders
       FROM products pr
       LEFT JOIN order_items oi ON oi.product_id = pr.id AND oi.status = 'active'
       LEFT JOIN orders o ON o.id = oi.order_id
      WHERE pr.period_id = $1
      GROUP BY pr.id ORDER BY pr.status, pr.name`,
    [id]
  );
  if (req.query.format === 'csv') {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      ['Product', 'Quantity', 'Orders', 'Unit price (KES)', 'Value (KES)', 'Supplier minimum', 'Status'].map(esc).join(','),
      ...rows.map((x) => [x.name, x.qty, x.orders, x.price_kes, x.value_kes, x.min_qty ?? '', x.status].map(esc).join(',')),
    ];
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="supplier-summary-${id}.csv"`);
    return res.send(lines.join('\n'));
  }
  res.json({ period, rows });
}));

// ---------- Products ----------
function productInput(b) {
  const name = String(b.name || '').trim();
  const price = int(b.price_kes);
  if (!name) throw bad('Enter a product name');
  if (!price || price <= 0) throw bad('Enter a price in KES');
  return {
    name, price,
    description: b.description ? String(b.description).trim() : null,
    imageUrl: b.image_url ? String(b.image_url).trim() : null,
    minQty: int(b.min_qty) || null,
    maxQty: int(b.max_qty) || null,
  };
}

r.post('/products', admin, ah(async (req, res) => {
  const periodId = int(req.body.period_id);
  const period = await one('SELECT * FROM shipping_periods WHERE id = $1', [periodId]);
  if (!period) throw bad('Choose a shipping period');
  if (period.status !== 'open') throw bad('This period is closed; add products to a new period');
  const p = productInput(req.body);
  const product = await one(
    `INSERT INTO products (period_id, name, description, price_kes, image_url, min_qty, max_qty)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [periodId, p.name, p.description, p.price, p.imageUrl, p.minQty, p.maxQty]
  );
  await audit(req.user.id, 'product.created', 'product', product.id, p);
  res.status(201).json({ product });
}));

r.patch('/products/:id', admin, ah(async (req, res) => {
  const id = int(req.params.id);
  const cur = await one('SELECT * FROM products WHERE id = $1', [id]);
  if (!cur) throw notFound();
  const p = productInput({ ...cur, ...req.body });
  // Prices already on orders are copied at checkout, so changing price only affects new orders
  const product = await one(
    `UPDATE products SET name = $2, description = $3, price_kes = $4, image_url = $5, min_qty = $6, max_qty = $7
      WHERE id = $1 RETURNING *`,
    [id, p.name, p.description, p.price, p.imageUrl, p.minQty, p.maxQty]
  );
  await audit(req.user.id, 'product.updated', 'product', id, p);
  res.json({ product });
}));

r.post('/products/:id/cancel', admin, ah(async (req, res) => {
  const orders = await cancelProduct(int(req.params.id), req.user.id);
  res.json({ ok: true, ordersAffected: orders });
}));

r.delete('/products/:id', admin, ah(async (req, res) => {
  const id = int(req.params.id);
  const used = await one('SELECT 1 FROM order_items WHERE product_id = $1 LIMIT 1', [id]);
  if (used) throw bad('This product is on orders. Cancel it instead, so customers are refunded and told.');
  await query('DELETE FROM products WHERE id = $1', [id]);
  await audit(req.user.id, 'product.deleted', 'product', id);
  res.json({ ok: true });
}));

// ---------- Payments ----------
r.get('/payments', admin, ah(async (req, res) => {
  const status = req.query.status;
  const payments = await many(
    `SELECT pa.*, o.order_no, u.name AS customer_name, a.name AS approved_by_name
       FROM payments pa
       LEFT JOIN orders o ON o.id = pa.order_id
       LEFT JOIN users u ON u.id = o.user_id
       LEFT JOIN users a ON a.id = pa.approved_by
      WHERE ($1::text IS NULL OR pa.status = $1)
      ORDER BY pa.id DESC LIMIT 300`,
    [status || null]
  );
  res.json({ payments: payments.map(({ raw_callback, ...p }) => p) });
}));

async function findOrderByNo(orderNo) {
  const o = await one('SELECT * FROM orders WHERE order_no = $1', [String(orderNo || '').trim().toUpperCase()]);
  if (!o) throw bad('No order with that number');
  return o;
}

// Record a payment made outside the system (e.g. Paybill before callbacks were set up, cash)
r.post('/payments/manual', admin, ah(async (req, res) => {
  const order = await findOrderByNo(req.body.order_no);
  const amount = int(req.body.amount_kes);
  const receipt = String(req.body.mpesa_receipt || '').trim().toUpperCase() || null;
  if (!amount || amount <= 0) throw bad('Enter the amount paid');
  if (receipt && (await one('SELECT id FROM payments WHERE mpesa_receipt = $1', [receipt]))) {
    throw bad('This M-Pesa receipt has already been recorded');
  }
  await tx(async (c) => {
    await c.query(
      `INSERT INTO payments (order_id, method, mpesa_receipt, amount_kes, status, result_desc, approved_by, approved_at)
       VALUES ($1, 'manual', $2, $3, 'approved', $4, $5, now())`,
      [order.id, receipt, amount, req.body.note || null, req.user.id]
    );
    await applyPayment(c, { orderId: order.id, amount, receipt });
  });
  await audit(req.user.id, 'payment.manual', 'order', order.id, { amount, receipt });
  res.json({ ok: true });
}));

// Attach a Paybill payment with a wrong account number to the right order
r.post('/payments/:id/match', admin, ah(async (req, res) => {
  const order = await findOrderByNo(req.body.order_no);
  await tx(async (c) => {
    const { rows } = await c.query(`SELECT * FROM payments WHERE id = $1 FOR UPDATE`, [int(req.params.id)]);
    const p = rows[0];
    if (!p || p.status !== 'unmatched') throw bad('Only unmatched payments can be matched');
    await c.query(
      `UPDATE payments SET order_id = $2, status = 'approved', approved_by = $3, approved_at = now() WHERE id = $1`,
      [p.id, order.id, req.user.id]
    );
    await applyPayment(c, { orderId: order.id, amount: p.amount_kes, receipt: p.mpesa_receipt });
  });
  await audit(req.user.id, 'payment.matched', 'payment', req.params.id, { order: order.order_no });
  res.json({ ok: true });
}));

r.post('/payments/:id/reject', admin, ah(async (req, res) => {
  const p = await one(
    `UPDATE payments SET status = 'rejected', result_desc = COALESCE($2, result_desc), approved_by = $3
      WHERE id = $1 AND status IN ('pending','unmatched') RETURNING id`,
    [int(req.params.id), req.body.note || null, req.user.id]
  );
  if (!p) throw bad('Only pending or unmatched payments can be rejected');
  await audit(req.user.id, 'payment.rejected', 'payment', p.id, { note: req.body.note });
  res.json({ ok: true });
}));

r.post('/mpesa/register-c2b', admin, ah(async (req, res) => {
  const result = await registerC2bUrls();
  await audit(req.user.id, 'mpesa.register_c2b', null, null, result);
  res.json({ result });
}));

// ---------- Orders ----------
r.get('/orders', staff, ah(async (req, res) => {
  const periodId = int(req.query.periodId);
  const status = req.query.status || null;
  const q = String(req.query.q || '').trim();
  const phone = normalizePhone(q);
  const orders = await many(
    `SELECT o.id, o.order_no, o.total_kes, o.paid_kes, o.refund_due_kes, o.payment_status, o.created_at,
            o.collected_at, o.collected_by_name, o.fulfilment, o.delivery_address, o.delivered_at,
            u.name AS customer_name, u.phone AS customer_phone, p.name AS period_name, p.status AS period_status
       FROM orders o JOIN users u ON u.id = o.user_id JOIN shipping_periods p ON p.id = o.period_id
      WHERE ($1::int IS NULL OR o.period_id = $1)
        AND ($2::text IS NULL OR o.payment_status = $2 OR ($2 = 'collected' AND o.collected_at IS NOT NULL)
             OR ($2 = 'to_deliver' AND o.fulfilment = 'delivery' AND o.payment_status = 'paid' AND o.collected_at IS NULL
                 AND p.status = 'ready_for_collection'))
        AND ($3 = '' OR o.order_no ILIKE '%' || $3 || '%' OR u.name ILIKE '%' || $3 || '%' OR u.phone = $4)
      ORDER BY o.id DESC LIMIT 500`,
    [periodId, status, q, phone || '']
  );
  res.json({ orders });
}));

r.get('/orders/:id', staff, ah(async (req, res) => {
  const order = await orderDetail('o.id = $1', [int(req.params.id)]);
  if (!order) throw notFound();
  res.json({ order });
}));

r.post('/orders/:id/refunded', admin, ah(async (req, res) => {
  const o = await one(
    `UPDATE orders SET refund_due_kes = 0,
            payment_status = CASE WHEN payment_status = 'refund_pending' THEN 'refunded' ELSE payment_status END
      WHERE id = $1 AND refund_due_kes > 0 RETURNING *`,
    [int(req.params.id)]
  );
  if (!o) throw bad('No refund is due on this order');
  await audit(req.user.id, 'order.refunded', 'order', o.id, { note: req.body.note });
  res.json({ order: o });
}));

r.post('/orders/:id/delivered', staff, ah(async (req, res) => {
  const order = await markDelivered({ orderId: int(req.params.id), actorId: req.user.id });
  res.json({ order });
}));

// ---------- Collection desk ----------
r.get('/collections/lookup', staff, ah(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ orders: [] });
  const phone = normalizePhone(q);
  const orders = await many(
    `SELECT o.id, o.order_no, o.total_kes, o.payment_status, o.collected_at, o.collected_by_name,
            (o.pickup_code_hash IS NOT NULL) AS ready, u.name AS customer_name, u.phone AS customer_phone,
            p.name AS period_name,
            (SELECT json_agg(json_build_object('name', oi.product_name, 'qty', oi.qty) ORDER BY oi.id)
               FROM order_items oi WHERE oi.order_id = o.id AND oi.status = 'active') AS items
       FROM orders o JOIN users u ON u.id = o.user_id JOIN shipping_periods p ON p.id = o.period_id
      WHERE o.payment_status = 'paid' AND o.fulfilment = 'pickup' AND (o.order_no = upper($1) OR u.phone = $2)
      ORDER BY o.id DESC LIMIT 20`,
    [q, phone || '']
  );
  res.json({ orders });
}));

r.post('/collections', staff, ah(async (req, res) => {
  const order = await collectOrder({
    orderNo: req.body.order_no,
    code: req.body.code,
    collectedByName: String(req.body.collected_by_name || '').trim(),
    collectedByPhone: normalizePhone(req.body.collected_by_phone) || null,
    actorId: req.user.id,
  });
  res.json({ order });
}));

// ---------- Proposed items ----------
r.get('/proposed-items', admin, ah(async (req, res) => {
  const items = await many(
    `SELECT pi.*, COUNT(i.id)::int AS interested, COALESCE(SUM(i.qty),0)::int AS total_qty
       FROM proposed_items pi LEFT JOIN interests i ON i.proposed_item_id = pi.id
      GROUP BY pi.id ORDER BY pi.active DESC, COUNT(i.id) DESC, pi.id DESC`
  );
  res.json({ items });
}));

r.post('/proposed-items', admin, ah(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw bad('Enter a name');
  const item = await one(
    `INSERT INTO proposed_items (name, description, image_url, est_price_kes) VALUES ($1,$2,$3,$4) RETURNING *`,
    [name, req.body.description || null, req.body.image_url || null, int(req.body.est_price_kes) || null]
  );
  await audit(req.user.id, 'proposed.created', 'proposed_item', item.id);
  res.status(201).json({ item });
}));

r.patch('/proposed-items/:id', admin, ah(async (req, res) => {
  const b = req.body;
  const item = await one(
    `UPDATE proposed_items SET
        name = COALESCE($2, name), description = COALESCE($3, description),
        image_url = COALESCE($4, image_url), est_price_kes = COALESCE($5, est_price_kes),
        active = COALESCE($6, active)
      WHERE id = $1 RETURNING *`,
    [int(req.params.id), b.name || null, b.description ?? null, b.image_url ?? null,
     int(b.est_price_kes) || null, typeof b.active === 'boolean' ? b.active : null]
  );
  if (!item) throw notFound();
  res.json({ item });
}));

r.delete('/proposed-items/:id', admin, ah(async (req, res) => {
  await query('DELETE FROM proposed_items WHERE id = $1', [int(req.params.id)]);
  res.json({ ok: true });
}));

// ---------- SMS log & audit ----------
r.get('/sms', admin, ah(async (req, res) => {
  const messages = await many(
    `SELECT s.*, u.name AS user_name FROM sms_messages s LEFT JOIN users u ON u.id = s.user_id
      WHERE s.template <> 'otp' ORDER BY s.id DESC LIMIT 300`
  );
  const stats = await one(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE sent_at > now() - interval '30 days')::int AS last_30_days,
            COUNT(*) FILTER (WHERE status ILIKE 'fail%' OR status ILIKE 'reject%')::int AS failed
       FROM sms_messages WHERE template <> 'otp'`
  );
  res.json({ messages, stats });
}));

r.get('/emails', admin, ah(async (req, res) => {
  const messages = await many(
    `SELECT e.*, u.name AS user_name FROM email_messages e LEFT JOIN users u ON u.id = e.user_id ORDER BY e.id DESC LIMIT 300`
  );
  const stats = await one(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE sent_at > now() - interval '30 days')::int AS last_30_days,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS failed FROM email_messages`
  );
  res.json({ messages, stats });
}));

// ---------- Settings ----------
r.get('/settings', admin, ah(async (req, res) => res.json({ fields: settingsForAdmin(), urls: callbackUrls() })));

r.put('/settings', admin, ah(async (req, res) => {
  await saveSettings(req.body.changes || {});
  await audit(req.user.id, 'settings.updated', 'settings', null, { keys: Object.keys(req.body.changes || {}) });
  res.json({ fields: settingsForAdmin(), urls: callbackUrls() });
}));

r.post('/settings/test-sms', admin, ah(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (!phone) throw bad('Enter a valid phone number');
  await sendSms({ userId: null, phone, body: 'Test message: your SMS settings are working.' }, 'test');
  const last = await one(`SELECT status, error FROM sms_messages WHERE phone = $1 AND template = 'test' ORDER BY id DESC LIMIT 1`, [phone]);
  if (/fail|reject/i.test(last?.status || '')) throw bad(`SMS failed: ${last.error || last.status}`);
  res.json({ ok: true, message: last?.status === 'logged' ? 'Provider is set to Off, so the message was only logged.' : 'Test SMS sent.' });
}));

r.post('/settings/test-email', admin, ah(async (req, res) => {
  const to = String(req.body.email || '').trim();
  if (!/^\S+@\S+\.\S+$/.test(to)) throw bad('Enter a valid email address');
  try {
    await sendEmail({ to, subject: 'Test email', body: 'Your Brevo email settings are working.', template: 'test' }, { throwOnError: true });
  } catch (e) { throw bad(e.message); }
  res.json({ ok: true, message: 'Test email sent.' });
}));

r.get('/audit', admin, ah(async (req, res) => {
  const rows = await many(
    `SELECT a.*, u.name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
      ORDER BY a.id DESC LIMIT 300`
  );
  res.json({ rows });
}));

// ---------- Staff accounts ----------
r.get('/users', admin, ah(async (req, res) => {
  const role = req.query.role;
  const users = await many(
    `SELECT u.id, u.name, u.phone, u.email, u.role, u.created_at,
            (SELECT COUNT(*)::int FROM orders o WHERE o.user_id = u.id AND o.payment_status = 'paid') AS paid_orders
       FROM users u
      WHERE ($1::text IS NULL OR u.role = $1)
      ORDER BY CASE u.role WHEN 'admin' THEN 0 WHEN 'staff' THEN 1 ELSE 2 END, u.id DESC LIMIT 500`,
    [role || null]
  );
  res.json({ users });
}));

r.post('/users', admin, ah(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const role = req.body.role;
  if (!phone) throw bad('Enter a valid phone number');
  if (!['staff', 'admin', 'customer'].includes(role)) throw bad('Choose a role');
  const user = await one(
    `INSERT INTO users (phone, name, role) VALUES ($1,$2,$3)
     ON CONFLICT (phone) DO UPDATE SET role = EXCLUDED.role, name = COALESCE(users.name, EXCLUDED.name)
     RETURNING id, name, phone, role`,
    [phone, String(req.body.name || '').trim() || null, role]
  );
  await audit(req.user.id, 'user.role', 'user', user.id, { role });
  res.json({ user });
}));

r.patch('/users/:id', admin, ah(async (req, res) => {
  const id = int(req.params.id);
  if (id === req.user.id) throw bad("You can't change your own role");
  if (!['staff', 'admin', 'customer'].includes(req.body.role)) throw bad('Choose a role');
  const user = await one('UPDATE users SET role = $2 WHERE id = $1 RETURNING id, name, phone, role', [id, req.body.role]);
  if (!user) throw notFound();
  await audit(req.user.id, 'user.role', 'user', id, { role: req.body.role });
  res.json({ user });
}));

export default r;
