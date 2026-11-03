import { config } from '../config.js';
import { pool, tx, one, many, audit } from '../db.js';
import { sendSmsLater } from './sms.js';
import { kes, fmtDate, sha256, randomDigits, displayPhone, STAGES, STAGE_LABELS, HttpError, bad } from '../util.js';

const biz = () => config.businessName;

// ---------- Order numbers ----------
export async function nextOrderNo(client) {
  const { rows } = await client.query(`SELECT nextval('order_no_seq') AS n`);
  return `PO${rows[0].n}`;
}

// ---------- Payments ----------
/**
 * Apply an approved payment to an order. Idempotent on mpesa receipt.
 * Returns the updated order.
 */
export async function applyPayment(client, { orderId, amount, receipt }) {
  const { rows } = await client.query(
    `SELECT o.*, u.phone, u.id AS uid, p.status AS period_status, p.closes_at
       FROM orders o JOIN users u ON u.id = o.user_id
       JOIN shipping_periods p ON p.id = o.period_id
      WHERE o.id = $1 FOR UPDATE OF o`,
    [orderId]
  );
  const o = rows[0];
  if (!o) throw new Error('Order not found for payment');

  const paid = o.paid_kes + amount;
  let status = o.payment_status;
  let refundDue = o.refund_due_kes;
  let sms;

  if (o.payment_status === 'cancelled' || o.payment_status === 'refund_pending' || o.payment_status === 'refunded') {
    // Money arrived for an order that is no longer active: owe it back
    status = 'refund_pending';
    refundDue += amount;
    sms = `${biz()}: We received KES ${amount.toLocaleString()} for order ${o.order_no}, but this order is closed. A refund will be processed.`;
  } else if (paid >= o.total_kes) {
    status = 'paid';
    if (paid > o.total_kes) refundDue += paid - o.total_kes;
    sms = `${biz()}: Payment of ${kes(amount)} received for order ${o.order_no}${receipt ? ` (${receipt})` : ''}. Your order is confirmed. Thank you!`;
  } else {
    sms = `${biz()}: Payment of ${kes(amount)} received for order ${o.order_no}. Balance ${kes(o.total_kes - paid)}.`;
  }

  const { rows: upd } = await client.query(
    `UPDATE orders SET paid_kes = $2, payment_status = $3, refund_due_kes = $4,
            paid_at = CASE WHEN $3 = 'paid' AND paid_at IS NULL THEN now() ELSE paid_at END
      WHERE id = $1 RETURNING *`,
    [orderId, paid, status, refundDue]
  );
  sendSmsLater({ userId: o.uid, phone: o.phone, body: sms }, 'payment_received');
  return upd[0];
}

// ---------- Period status (the whole batch moves together) ----------
const SHIPPING_MSG = {
  in_transit: (p) => `your ${p} preorder is on the way.`,
};

export async function setPeriodStatus(periodId, newStatus, { etaDate, note, actorId }) {
  if (!STAGES.includes(newStatus)) throw bad('Unknown status');
  const period = await one('SELECT * FROM shipping_periods WHERE id = $1', [periodId]);
  if (!period) throw new HttpError(404, 'Period not found');

  const from = STAGES.indexOf(period.status);
  const to = STAGES.indexOf(newStatus);
  const etaChanged = etaDate !== undefined && (etaDate || null) !== (period.eta_date || null);

  if (to < from) throw bad(`Cannot move back from "${STAGE_LABELS[period.status]}" to "${STAGE_LABELS[newStatus]}"`);
  if (to === from && !etaChanged && !note) throw bad('Nothing to update');
  if (from === 0 && to > 1) throw bad('Close the period for orders before moving to shipping stages');

  if (newStatus === 'closed' && period.status !== 'closed') {
    await closePeriod(periodId, actorId);
  } else {
    await pool.query(
      `UPDATE shipping_periods SET status = $2, eta_date = COALESCE($3, eta_date) WHERE id = $1`,
      [periodId, newStatus, etaDate || null]
    );
  }

  await pool.query(
    `INSERT INTO status_events (period_id, status, note, eta_date, created_by) VALUES ($1,$2,$3,$4,$5)`,
    [periodId, newStatus, note || null, etaDate || period.eta_date || null, actorId || null]
  );
  await audit(actorId, 'period.status', 'period', periodId, { from: period.status, to: newStatus, etaDate, note });

  // Notify paid customers about shipping progress
  const updated = await one('SELECT * FROM shipping_periods WHERE id = $1', [periodId]);
  if (to >= STAGES.indexOf('in_transit')) {
    await notifyShippingUpdate(updated, newStatus, to === from && etaChanged, note);
  }
  return updated;
}

async function paidOrdersForPeriod(periodId, client = pool) {
  const { rows } = await client.query(
    `SELECT o.id, o.order_no, u.id AS user_id, u.phone
       FROM orders o JOIN users u ON u.id = o.user_id
      WHERE o.period_id = $1 AND o.payment_status = 'paid' AND o.collected_at IS NULL`,
    [periodId]
  );
  return rows;
}

async function notifyShippingUpdate(period, status, etaOnly, note) {
  const orders = await paidOrdersForPeriod(period.id);
  if (!orders.length) return;
  const eta = period.eta_date ? ` Expected arrival: ${fmtDate(period.eta_date)}.` : '';

  if (status === 'ready_for_collection') {
    // Each order gets its own pickup code
    const msgs = [];
    await tx(async (c) => {
      for (const o of orders) {
        const code = randomDigits(6);
        await c.query('UPDATE orders SET pickup_code_hash = $2 WHERE id = $1', [o.id, sha256(`${o.id}:${code}`)]);
        msgs.push({
          userId: o.user_id, phone: o.phone,
          body: `${biz()}: Your order ${o.order_no} is ready for collection at ${config.shopLocation}. Pickup code: ${code}. Show this code when collecting.`,
        });
      }
    });
    sendSmsLater(msgs, 'ready_for_collection');
    return;
  }
  if (status === 'completed') return;

  let body;
  if (etaOnly) body = `${biz()}: Update on your ${period.name} preorder.${eta || ' The arrival date has changed.'}`;
  else if (SHIPPING_MSG[status]) body = `${biz()}: Good news, ${SHIPPING_MSG[status](period.name)}${eta}`;
  else return;
  if (note) body += ` ${note}`;
  sendSmsLater(orders.map((o) => ({ userId: o.user_id, phone: o.phone, body })), `status_${status}`);
}

// Once every paid order in a ready round is collected, the round is finished
async function completeIfAllCollected(periodId, actorId) {
  const done = await one(
    `UPDATE shipping_periods SET status = 'completed'
      WHERE id = $1 AND status = 'ready_for_collection'
        AND NOT EXISTS (SELECT 1 FROM orders WHERE period_id = $1 AND payment_status = 'paid' AND collected_at IS NULL)
      RETURNING id`,
    [periodId]
  );
  if (!done) return;
  await pool.query(
    `INSERT INTO status_events (period_id, status, note, created_by) VALUES ($1, 'completed', 'All orders collected', $2)`,
    [periodId, actorId || null]
  );
}

// ---------- Closing a period ----------
export async function closePeriod(periodId, actorId) {
  const cancelled = await tx(async (c) => {
    const { rows: p } = await c.query(`SELECT * FROM shipping_periods WHERE id = $1 FOR UPDATE`, [periodId]);
    if (!p[0] || p[0].status !== 'open') return [];
    await c.query(`UPDATE shipping_periods SET status = 'closed' WHERE id = $1`, [periodId]);
    // Unpaid orders are cancelled. Part-paid orders are cancelled and refunded.
    const { rows } = await c.query(
      `UPDATE orders o SET
          payment_status = CASE WHEN o.paid_kes > 0 THEN 'refund_pending' ELSE 'cancelled' END,
          refund_due_kes = o.refund_due_kes + o.paid_kes
        FROM users u
       WHERE o.user_id = u.id AND o.period_id = $1 AND o.payment_status = 'unpaid'
       RETURNING o.order_no, o.paid_kes, u.id AS user_id, u.phone`,
      [periodId]
    );
    await c.query(
      `DELETE FROM cart_items ci USING products pr WHERE ci.product_id = pr.id AND pr.period_id = $1`,
      [periodId]
    );
    return rows;
  });
  await audit(actorId, 'period.closed', 'period', periodId, { cancelledOrders: cancelled.length });
  sendSmsLater(
    cancelled.map((o) => ({
      userId: o.user_id, phone: o.phone,
      body: o.paid_kes > 0
        ? `${biz()}: Orders have closed and order ${o.order_no} was not fully paid. It has been cancelled and your ${kes(o.paid_kes)} will be refunded.`
        : `${biz()}: Orders have closed. Order ${o.order_no} was not paid and has been cancelled.`,
    })),
    'unpaid_cancelled'
  );
  return cancelled.length;
}

export async function notifyPeriodOpened(periodId) {
  const period = await one('UPDATE shipping_periods SET announced_at = now() WHERE id = $1 RETURNING *', [periodId]);
  const users = await many(`SELECT id, phone FROM users WHERE role = 'customer' AND sms_opt_in`);
  sendSmsLater(
    users.map((u) => ({
      userId: u.id, phone: u.phone,
      body: `${biz()}: New items are open for preorder (${period.name}). Order before ${fmtDate(period.closes_at)}.`,
    })),
    'period_opened'
  );
}

export async function sendClosingReminder(periodId) {
  const period = await one('SELECT * FROM shipping_periods WHERE id = $1', [periodId]);
  const users = await many(
    `SELECT DISTINCT u.id, u.phone FROM users u
      WHERE u.sms_opt_in AND (
        EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.period_id = $1 AND o.payment_status = 'unpaid')
        OR EXISTS (SELECT 1 FROM cart_items ci JOIN products p ON p.id = ci.product_id
                    WHERE ci.user_id = u.id AND p.period_id = $1))`,
    [periodId]
  );
  await pool.query('UPDATE shipping_periods SET reminder_sent_at = now() WHERE id = $1', [periodId]);
  sendSmsLater(
    users.map((u) => ({
      userId: u.id, phone: u.phone,
      body: `${biz()}: Orders for ${period.name} close on ${fmtDate(period.closes_at)}. Complete your order and payment to secure your items.`,
    })),
    'closing_reminder'
  );
  return users.length;
}

// ---------- Cancelling a product (e.g. supplier minimum not met) ----------
export async function cancelProduct(productId, actorId) {
  const affected = await tx(async (c) => {
    const { rows: pr } = await c.query(`UPDATE products SET status = 'cancelled' WHERE id = $1 RETURNING *`, [productId]);
    if (!pr[0]) throw new HttpError(404, 'Product not found');
    await c.query('DELETE FROM cart_items WHERE product_id = $1', [productId]);
    const { rows: items } = await c.query(
      `UPDATE order_items SET status = 'cancelled'
        WHERE product_id = $1 AND status = 'active' RETURNING order_id, qty, unit_price_kes`,
      [productId]
    );
    const out = [];
    for (const it of items) {
      const amount = it.qty * it.unit_price_kes;
      const { rows } = await c.query(
        `SELECT o.*, u.phone, u.id AS uid FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = $1 FOR UPDATE OF o`,
        [it.order_id]
      );
      const o = rows[0];
      const newTotal = o.total_kes - amount;
      let refund = 0;
      let status = o.payment_status;
      if (o.payment_status === 'paid') {
        refund = Math.min(amount, o.paid_kes);
        if (newTotal <= 0) status = 'refund_pending';
      } else if (o.payment_status === 'unpaid') {
        if (o.paid_kes > newTotal) refund = o.paid_kes - Math.max(newTotal, 0);
        if (newTotal <= 0) status = o.paid_kes > 0 ? 'refund_pending' : 'cancelled';
        else if (o.paid_kes >= newTotal) status = 'paid';
      }
      await c.query(
        `UPDATE orders SET total_kes = $2, refund_due_kes = refund_due_kes + $3, payment_status = $4 WHERE id = $1`,
        [o.id, Math.max(newTotal, 0), refund, status]
      );
      out.push({ ...o, refund, productName: pr[0].name });
    }
    return out;
  });
  await audit(actorId, 'product.cancelled', 'product', productId, { orders: affected.length });
  sendSmsLater(
    affected.map((o) => ({
      userId: o.uid, phone: o.phone,
      body: `${biz()}: Sorry, ${o.productName} in order ${o.order_no} will not be shipped this round.` +
        (o.refund > 0 ? ` A refund of ${kes(o.refund)} will be processed.` : ' It has been removed from your order.'),
    })),
    'product_cancelled'
  );
  return affected.length;
}

// ---------- Collection at the shop ----------
export async function collectOrder({ orderNo, code, collectedByName, collectedByPhone, actorId }) {
  const o = await one(
    `SELECT o.*, u.phone, u.name AS customer_name, p.status AS period_status
       FROM orders o JOIN users u ON u.id = o.user_id JOIN shipping_periods p ON p.id = o.period_id
      WHERE o.order_no = $1`,
    [String(orderNo || '').trim().toUpperCase()]
  );
  if (!o) throw new HttpError(404, 'Order not found');
  if (o.payment_status !== 'paid') throw bad('This order is not paid');
  if (o.collected_at) throw bad(`Already collected on ${fmtDate(o.collected_at)} by ${o.collected_by_name}`);
  if (!o.pickup_code_hash) throw bad('This order is not ready for collection yet');
  if (sha256(`${o.id}:${String(code || '').trim()}`) !== o.pickup_code_hash) throw bad('Wrong pickup code');
  if (!collectedByName) throw bad('Enter the name of the person collecting');

  const updated = await one(
    `UPDATE orders SET collected_at = now(), collected_by_name = $2, collected_by_phone = $3, released_by = $4
      WHERE id = $1 RETURNING *`,
    [o.id, collectedByName, collectedByPhone || null, actorId]
  );
  await audit(actorId, 'order.collected', 'order', o.id, { collectedByName, collectedByPhone });
  const who = collectedByPhone ? `${collectedByName}, ${displayPhone(collectedByPhone)}` : collectedByName;
  sendSmsLater(
    { userId: o.user_id, phone: o.phone, body: `${biz()}: Order ${o.order_no} was collected by ${who} on ${fmtDate(updated.collected_at)}. Thank you for shopping with us.` },
    'collected'
  );
  await completeIfAllCollected(o.period_id, actorId);
  return updated;
}
