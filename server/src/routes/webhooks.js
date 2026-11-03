import { Router } from 'express';
import { config } from '../config.js';
import { one, query, tx } from '../db.js';
import { parseStkCallback } from '../services/mpesa.js';
import { parseSunpay, verifySunpaySignature } from '../services/payments.js';
import { applyPayment } from '../services/orders.js';
import { ah } from '../util.js';

const r = Router();

const checkSecret = (req, res, next) =>
  req.params.secret === config.mpesa.callbackSecret ? next() : res.status(404).end();

/** Process the result of an STK push (from Safaricom, or the mock). Idempotent. */
export async function handleStkResult(result) {
  await tx(async (c) => {
    const { rows } = await c.query(
      `SELECT * FROM payments WHERE checkout_request_id = $1 FOR UPDATE`,
      [result.checkoutRequestId]
    );
    const payment = rows[0];
    if (!payment || payment.status !== 'pending') return;
    if (result.resultCode !== 0) {
      await c.query(
        `UPDATE payments SET status = 'failed', result_desc = $2 WHERE id = $1`,
        [payment.id, result.resultDesc]
      );
      return;
    }
    const amount = result.amount ?? payment.amount_kes;
    await c.query(
      `UPDATE payments SET status = 'approved', mpesa_receipt = $2, amount_kes = $3, result_desc = $4,
              approved_at = now(), raw_callback = $5 WHERE id = $1`,
      [payment.id, result.receipt, amount, result.resultDesc, JSON.stringify(result)]
    );
    await applyPayment(c, { orderId: payment.order_id, amount, receipt: result.receipt });
  });
}

// SunPay results. Per-transaction callback: the secret is in the address.
const sunpayResult = async (body) => {
  const result = parseSunpay(body?.data ?? body);
  if (result) await handleStkResult(result);
};
r.post('/sunpay/:secret', checkSecret, ah(async (req, res) => {
  await sunpayResult(req.body);
  res.json({ ok: true });
}));
// SunPay registered webhook: signed with HMAC-SHA256 over the raw body
r.post('/sunpay', ah(async (req, res) => {
  if (!verifySunpaySignature(req.rawBody, req.headers['x-webhook-signature'])) return res.status(401).json({ error: 'Bad signature' });
  await sunpayResult(req.body);
  res.json({ ok: true });
}));

// STK push result
r.post('/mpesa/stk/:secret', checkSecret, ah(async (req, res) => {
  const result = parseStkCallback(req.body);
  if (result) await handleStkResult(result);
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
}));

// Paybill validation: accept everything (we match or flag afterwards)
r.post('/mpesa/c2b-validate/:secret', checkSecret, (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

// Paybill confirmation: customer paid with Account = order number
r.post('/mpesa/c2b/:secret', checkSecret, ah(async (req, res) => {
  const b = req.body || {};
  const receipt = b.TransID;
  const amount = Math.round(Number(b.TransAmount || 0));
  const ref = String(b.BillRefNumber || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!receipt || !amount) return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

  const exists = await one('SELECT id FROM payments WHERE mpesa_receipt = $1', [receipt]);
  if (exists) return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

  const order = await one('SELECT id FROM orders WHERE order_no = $1', [ref]);
  if (!order) {
    // Wrong account number: keep it for an admin to match manually
    await query(
      `INSERT INTO payments (method, mpesa_receipt, phone, amount_kes, status, result_desc, raw_callback)
       VALUES ('paybill', $1, $2, $3, 'unmatched', $4, $5)`,
      [receipt, String(b.MSISDN || ''), amount, `Account "${b.BillRefNumber || ''}" not found`, JSON.stringify(b)]
    );
    return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }
  await tx(async (c) => {
    await c.query(
      `INSERT INTO payments (order_id, method, mpesa_receipt, phone, amount_kes, status, approved_at, raw_callback)
       VALUES ($1, 'paybill', $2, $3, $4, 'approved', now(), $5)`,
      [order.id, receipt, String(b.MSISDN || ''), amount, JSON.stringify(b)]
    );
    await applyPayment(c, { orderId: order.id, amount, receipt });
  });
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
}));

// Africa's Talking delivery reports (form-encoded)
r.post('/sms/delivery', ah(async (req, res) => {
  const { id, status } = req.body || {};
  if (id && status) await query('UPDATE sms_messages SET status = $2 WHERE provider_id = $1', [id, status]);
  res.sendStatus(200);
}));

export default r;
