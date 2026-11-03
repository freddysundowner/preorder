import crypto from 'node:crypto';
import { config } from '../config.js';
import { stkPush as darajaStk } from './mpesa.js';

const sunpayUrl = (p) => `${config.payments.sunpayBaseUrl.replace(/\/$/, '')}${p}`;
const sunpayHeaders = () => ({ Authorization: `Bearer ${config.payments.sunpayApiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' });

export const callbackPath = (kind) => `${config.publicApiUrl.replace(/\/$/, '')}/api/webhooks/${kind}/${config.mpesa.callbackSecret}`;

async function sunpayStk({ phone, amount, accountRef }) {
  if (!config.payments.sunpayApiKey) throw new Error('SunPay is not set up yet (add the API key in Settings)');
  const { settleType, settleShortcode, settleAccount } = config.payments;
  const body = {
    phoneNumber: phone,
    amount: Math.round(amount),
    externalRef: accountRef,
    callbackUrl: callbackPath('sunpay'),
  };
  if (settleType !== 'none' && settleShortcode) {
    body.settleTo = { type: settleType, shortcode: settleShortcode, ...(settleType === 'paybill' ? { accountReference: settleAccount || accountRef } : {}) };
  }
  const res = await fetch(sunpayUrl('/payments/stk-push'), { method: 'POST', headers: sunpayHeaders(), body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false || !json.transactionId) {
    throw new Error(json.message || json.error || `SunPay error (${res.status})`);
  }
  // transactionId is what SunPay sends back in its results, so it is our reference
  return { checkoutRequestId: json.transactionId, customerMessage: json.message };
}

/** Ask the customer's phone to pay. Returns { checkoutRequestId } (the provider's reference). */
export async function startPayment({ phone, amount, accountRef, description }) {
  const provider = config.payments.provider;
  if (provider === 'sunpay') return sunpayStk({ phone, amount, accountRef });
  if (provider === 'daraja') return darajaStk({ phone, amount, accountRef, description });
  const id = 'MOCK_' + Date.now() + Math.floor(Math.random() * 1000);
  return { checkoutRequestId: id, customerMessage: 'Test payment started' };
}

/** Turn a SunPay result (webhook `data` object, or a status lookup) into our common shape. */
export function parseSunpay(d) {
  if (!d || !d.transactionId) return null;
  if (d.paymentType && d.paymentType !== 'stk_push') return null;
  const status = String(d.status || '').toLowerCase();
  if (status === 'pending' || status === 'processing') return null;
  const resultCode = d.resultCode != null ? Number(d.resultCode) : status === 'completed' ? 0 : 1;
  return {
    checkoutRequestId: d.transactionId,
    resultCode,
    resultDesc: d.resultDesc || (status === 'completed' ? 'Paid' : 'Payment failed'),
    amount: d.amount != null ? Math.round(Number(d.amount)) : null,
    receipt: d.mpesaRef || null,
    phone: d.phoneNumber ? String(d.phoneNumber) : null,
  };
}

/** Look up a SunPay payment directly, in case the webhook never arrived. */
export async function sunpayStatus(transactionId) {
  const res = await fetch(sunpayUrl(`/payments/${encodeURIComponent(transactionId)}`), { headers: sunpayHeaders() });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || `SunPay lookup failed (${res.status})`);
  const d = json.data || json;
  return parseSunpay({ ...d, transactionId: d.transactionId || d.id });
}

export function verifySunpaySignature(rawBody, signature) {
  const secret = config.payments.sunpayWebhookSecret;
  if (!secret || !signature || !rawBody) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
