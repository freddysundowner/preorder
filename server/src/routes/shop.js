import { Router } from 'express';
import { config } from '../config.js';
import { one, many, query, tx, audit } from '../db.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { startPayment, sunpayStatus } from '../services/payments.js';
import { nextOrderNo } from '../services/orders.js';
import { handleStkResult } from './webhooks.js';
import { sendSmsLater } from '../services/sms.js';
import { ah, bad, notFound, int, normalizePhone, kes, fmtDate } from '../util.js';

const r = Router();

// The period customers can order from right now
export async function currentPeriod() {
  return one(
    `SELECT * FROM shipping_periods
      WHERE status = 'open' AND opens_at <= now() AND closes_at > now()
      ORDER BY closes_at ASC LIMIT 1`
  );
}

// Public business info for the frontend
r.get('/info', (req, res) => {
  res.json({
    businessName: config.businessName,
    shopLocation: config.shopLocation,
    collectionTitle: config.collectionTitle,
    storeHeadline: config.storeHeadline,
    storeTagline: config.storeTagline,
    paybillNumber: config.paybillNumber,
    paymentProvider: config.payments.provider,
  });
});

r.get('/periods/current', ah(async (req, res) => {
  const period = await currentPeriod();
  if (!period) {
    const next = await one(
      `SELECT id, name, opens_at, closes_at FROM shipping_periods
        WHERE status IN ('open','draft') AND opens_at > now() ORDER BY opens_at LIMIT 1`
    );
    return res.json({ period: null, products: [], next });
  }
  const products = await many(
    `SELECT id, name, description, price_kes, image_url, max_qty FROM products
      WHERE period_id = $1 AND status = 'active' ORDER BY id`,
    [period.id]
  );
  res.json({ period, products });
}));

// ---------- Cart ----------
async function cartFor(userId) {
  const period = await currentPeriod();
  if (!period) return { period: null, items: [], total: 0 };
  const items = await many(
    `SELECT ci.id, ci.qty, p.id AS product_id, p.name, p.price_kes, p.image_url, p.max_qty
       FROM cart_items ci JOIN products p ON p.id = ci.product_id
      WHERE ci.user_id = $1 AND p.period_id = $2 AND p.status = 'active' ORDER BY ci.id`,
    [userId, period.id]
  );
  const total = items.reduce((s, i) => s + i.qty * i.price_kes, 0);
  return { period, items, total };
}

r.get('/cart', requireAuth, ah(async (req, res) => res.json(await cartFor(req.user.id))));

// Set the quantity of a product in the cart (qty 0 removes it)
r.post('/cart/items', requireAuth, ah(async (req, res) => {
  const productId = int(req.body.productId);
  const qty = int(req.body.qty);
  if (!productId || qty == null || qty < 0) throw bad('Invalid product or quantity');
  const period = await currentPeriod();
  if (!period) throw bad('Orders are closed right now');
  const product = await one(
    `SELECT * FROM products WHERE id = $1 AND period_id = $2 AND status = 'active'`,
    [productId, period.id]
  );
  if (!product) throw notFound('This product is not available');
  if (product.max_qty && qty > product.max_qty) throw bad(`You can order at most ${product.max_qty} of this item`);
  if (qty === 0) {
    await query('DELETE FROM cart_items WHERE user_id = $1 AND product_id = $2', [req.user.id, productId]);
  } else {
    await query(
      `INSERT INTO cart_items (user_id, product_id, qty) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, product_id) DO UPDATE SET qty = EXCLUDED.qty`,
      [req.user.id, productId, qty]
    );
  }
  res.json(await cartFor(req.user.id));
}));

// ---------- Orders ----------
r.post('/orders/checkout', requireAuth, ah(async (req, res) => {
  const cart = await cartFor(req.user.id);
  if (!cart.period) throw bad('Orders are closed right now');
  if (!cart.items.length) throw bad('Your cart is empty');

  const order = await tx(async (c) => {
    const orderNo = await nextOrderNo(c);
    const { rows } = await c.query(
      `INSERT INTO orders (order_no, user_id, period_id, total_kes) VALUES ($1,$2,$3,$4) RETURNING *`,
      [orderNo, req.user.id, cart.period.id, cart.total]
    );
    for (const it of cart.items) {
      await c.query(
        `INSERT INTO order_items (order_id, product_id, product_name, qty, unit_price_kes) VALUES ($1,$2,$3,$4,$5)`,
        [rows[0].id, it.product_id, it.name, it.qty, it.price_kes]
      );
    }
    await c.query(
      `DELETE FROM cart_items ci USING products p WHERE ci.product_id = p.id AND ci.user_id = $1 AND p.period_id = $2`,
      [req.user.id, cart.period.id]
    );
    return rows[0];
  });
  await audit(req.user.id, 'order.created', 'order', order.id, { total: order.total_kes });
  sendSmsLater({
    userId: req.user.id, phone: req.user.phone,
    body: `${config.businessName}: Order ${order.order_no} received. Total ${kes(order.total_kes)}. Pay via M-Pesa Paybill ${config.paybillNumber}, Account ${order.order_no}, before ${fmtDate(cart.period.closes_at)}.`,
  }, 'invoice');
  res.status(201).json({ order });
}));

r.get('/orders', requireAuth, ah(async (req, res) => {
  const orders = await many(
    `SELECT o.*, p.name AS period_name, p.status AS period_status, p.eta_date, p.closes_at,
            (SELECT COUNT(*)::int FROM order_items oi WHERE oi.order_id = o.id AND oi.status = 'active') AS item_count,
            (SELECT string_agg(oi.product_name || ' × ' || oi.qty, ', ' ORDER BY oi.id) FROM order_items oi WHERE oi.order_id = o.id AND oi.status = 'active') AS items_summary
       FROM orders o JOIN shipping_periods p ON p.id = o.period_id
      WHERE o.user_id = $1 ORDER BY o.id DESC`,
    [req.user.id]
  );
  res.json({ orders: orders.map(({ pickup_code_hash, ...o }) => ({ ...o, ready: !!pickup_code_hash })) });
}));

export async function orderDetail(where, params) {
  const order = await one(
    `SELECT o.*, p.name AS period_name, p.status AS period_status, p.eta_date, p.closes_at,
            u.name AS customer_name, u.phone AS customer_phone
       FROM orders o JOIN shipping_periods p ON p.id = o.period_id JOIN users u ON u.id = o.user_id
      WHERE ${where}`,
    params
  );
  if (!order) return null;
  const [items, payments, events] = await Promise.all([
    many('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [order.id]),
    many(`SELECT id, method, mpesa_receipt, phone, amount_kes, status, result_desc, created_at
            FROM payments WHERE order_id = $1 ORDER BY id DESC`, [order.id]),
    many(`SELECT status, note, eta_date, created_at FROM status_events
           WHERE period_id = $1 AND created_at >= $2 ORDER BY id`, [order.period_id, order.created_at]),
  ]);
  const { pickup_code_hash, ...rest } = order;
  return { ...rest, ready: !!pickup_code_hash, items, payments, events };
}

r.get('/orders/:id', requireAuth, ah(async (req, res) => {
  const order = await orderDetail('o.id = $1 AND o.user_id = $2', [int(req.params.id), req.user.id]);
  if (!order) throw notFound('Order not found');
  res.json({ order });
}));

r.post('/orders/:id/cancel', requireAuth, ah(async (req, res) => {
  const o = await one(
    `SELECT o.*, p.status AS period_status FROM orders o JOIN shipping_periods p ON p.id = o.period_id
      WHERE o.id = $1 AND o.user_id = $2`,
    [int(req.params.id), req.user.id]
  );
  if (!o) throw notFound('Order not found');
  if (o.period_status !== 'open') throw bad('Orders have closed, so this order can no longer be cancelled');
  if (!['unpaid', 'paid'].includes(o.payment_status)) throw bad('This order is already cancelled');
  const status = o.paid_kes > 0 ? 'refund_pending' : 'cancelled';
  await query(
    `UPDATE orders SET payment_status = $2, refund_due_kes = refund_due_kes + paid_kes WHERE id = $1`,
    [o.id, status]
  );
  await audit(req.user.id, 'order.cancelled', 'order', o.id, { by: 'customer' });
  sendSmsLater({
    userId: req.user.id, phone: req.user.phone,
    body: `${config.businessName}: Order ${o.order_no} has been cancelled.` + (o.paid_kes > 0 ? ` Your ${kes(o.paid_kes)} will be refunded.` : ''),
  }, 'order_cancelled');
  res.json({ ok: true });
}));

// Start an M-Pesa STK push for the unpaid balance
r.post('/orders/:id/pay', requireAuth, ah(async (req, res) => {
  const o = await one(
    `SELECT o.*, p.status AS period_status FROM orders o JOIN shipping_periods p ON p.id = o.period_id
      WHERE o.id = $1 AND o.user_id = $2`,
    [int(req.params.id), req.user.id]
  );
  if (!o) throw notFound('Order not found');
  if (o.payment_status !== 'unpaid') throw bad('This order does not need payment');
  if (o.period_status !== 'open') throw bad('Orders have closed for this period');
  const phone = normalizePhone(req.body.phone || req.user.phone);
  if (!phone) throw bad('Enter a valid M-Pesa phone number');
  const amount = o.total_kes - o.paid_kes;

  // One prompt at a time: a second prompt while the first is open could charge the customer twice
  const waiting = await one(
    `SELECT 1 FROM payments WHERE order_id = $1 AND status = 'pending' AND method = 'stk' AND created_at > now() - interval '90 seconds'`,
    [o.id]
  );
  if (waiting) throw bad('A payment request is already on its way to your phone. Complete it there, or wait a minute and try again.');

  let stk;
  try {
    stk = await startPayment({ phone, amount, accountRef: o.order_no, description: 'Preorder' });
  } catch (e) {
    console.error('[payment] could not start:', e.message);
    throw Object.assign(new Error("We couldn't send the payment request to your phone. Please check the number and try again, or contact us."), { status: 502, expose: true });
  }
  const payment = await one(
    `INSERT INTO payments (order_id, method, checkout_request_id, phone, amount_kes, status)
     VALUES ($1, 'stk', $2, $3, $4, 'pending') RETURNING id, status, amount_kes`,
    [o.id, stk.checkoutRequestId, phone, amount]
  );

  if (config.payments.provider === 'mock') {
    // Simulate the customer approving the prompt on their phone
    setTimeout(() => {
      handleStkResult({
        checkoutRequestId: stk.checkoutRequestId, resultCode: 0, resultDesc: 'Mock payment approved',
        amount, receipt: 'MOCK' + Date.now().toString(36).toUpperCase(), phone,
      }).catch((e) => console.error('[mock stk]', e));
    }, 4000);
  }
  res.json({ payment, message: 'Check your phone and enter your M-Pesa PIN to complete payment.' });
}));

// Check a pending payment with the provider (used while the customer is waiting, in case a webhook is late)
r.post('/orders/:id/refresh-payment', requireAuth, ah(async (req, res) => {
  const o = await one('SELECT id FROM orders WHERE id = $1 AND user_id = $2', [int(req.params.id), req.user.id]);
  if (!o) throw notFound('Order not found');
  if (config.payments.provider === 'sunpay' && config.payments.sunpayApiKey) {
    const pending = await many(`SELECT checkout_request_id FROM payments WHERE order_id = $1 AND status = 'pending' AND method = 'stk'`, [o.id]);
    for (const p of pending) {
      try {
        const result = await sunpayStatus(p.checkout_request_id);
        if (result) await handleStkResult(result);
      } catch (e) { console.error('[sunpay] status check failed:', e.message); }
    }
  }
  res.json({ ok: true });
}));

// ---------- Proposed items ("coming soon") ----------
r.get('/proposed-items', optionalAuth, ah(async (req, res) => {
  const items = await many(
    `SELECT pi.id, pi.name, pi.description, pi.image_url, pi.est_price_kes,
            (SELECT COUNT(*)::int FROM interests i WHERE i.proposed_item_id = pi.id) AS interest_count,
            (SELECT qty FROM interests i WHERE i.proposed_item_id = pi.id AND i.user_id = $1) AS my_qty
       FROM proposed_items pi WHERE pi.active ORDER BY pi.id DESC`,
    [req.user?.id ?? null]
  );
  res.json({ items });
}));

r.post('/proposed-items/:id/interest', requireAuth, ah(async (req, res) => {
  const id = int(req.params.id);
  const qty = Math.max(1, Math.min(100, int(req.body.qty) || 1));
  const item = await one('SELECT id FROM proposed_items WHERE id = $1 AND active', [id]);
  if (!item) throw notFound('Item not found');
  await query(
    `INSERT INTO interests (proposed_item_id, user_id, qty) VALUES ($1,$2,$3)
     ON CONFLICT (proposed_item_id, user_id) DO UPDATE SET qty = EXCLUDED.qty`,
    [id, req.user.id, qty]
  );
  res.json({ ok: true });
}));

r.delete('/proposed-items/:id/interest', requireAuth, ah(async (req, res) => {
  await query('DELETE FROM interests WHERE proposed_item_id = $1 AND user_id = $2', [int(req.params.id), req.user.id]);
  res.json({ ok: true });
}));

export default r;
