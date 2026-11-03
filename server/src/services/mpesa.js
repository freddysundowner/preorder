import { config } from '../config.js';

const base = () =>
  config.mpesa.mode === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';

let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const auth = Buffer.from(`${config.mpesa.consumerKey}:${config.mpesa.consumerSecret}`).toString('base64');
  const res = await fetch(`${base()}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) throw new Error(`M-Pesa auth failed (${res.status})`);
  const json = await res.json();
  cachedToken = json.access_token;
  tokenExpiry = Date.now() + (Number(json.expires_in || 3599) - 60) * 1000;
  return cachedToken;
}

// Daraja wants the timestamp in Kenyan time: YYYYMMDDHHmmss
function timestamp() {
  const d = new Date(Date.now() + 3 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

export const callbackUrl = (kind) =>
  `${config.publicApiUrl.replace(/\/$/, '')}/api/webhooks/mpesa/${kind}/${config.mpesa.callbackSecret}`;

/**
 * Start an STK Push. Returns { checkoutRequestId, merchantRequestId, customerMessage }.
 */
export async function stkPush({ phone, amount, accountRef, description }) {
  if (config.payments.provider === 'mock') {
    const id = 'ws_CO_MOCK_' + Date.now() + Math.floor(Math.random() * 1000);
    return { checkoutRequestId: id, merchantRequestId: 'MOCK', customerMessage: 'Mock STK push sent' };
  }
  const token = await getToken();
  const ts = timestamp();
  const password = Buffer.from(config.mpesa.shortcode + config.mpesa.passkey + ts).toString('base64');
  const res = await fetch(`${base()}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: config.mpesa.shortcode,
      Password: password,
      Timestamp: ts,
      TransactionType: config.mpesa.transactionType,
      Amount: Math.round(amount),
      PartyA: phone,
      PartyB: config.mpesa.shortcode,
      PhoneNumber: phone,
      CallBackURL: callbackUrl('stk'),
      AccountReference: String(accountRef).slice(0, 12),
      TransactionDesc: String(description || 'Order payment').slice(0, 13),
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ResponseCode !== '0') {
    throw new Error(json.errorMessage || json.ResponseDescription || `STK push failed (${res.status})`);
  }
  return {
    checkoutRequestId: json.CheckoutRequestID,
    merchantRequestId: json.MerchantRequestID,
    customerMessage: json.CustomerMessage,
  };
}

/** Register C2B (Paybill) confirmation + validation URLs with Safaricom. */
export async function registerC2bUrls() {
  if (config.payments.provider === 'mock') return { mock: true, confirmationUrl: callbackUrl('c2b') };
  const token = await getToken();
  const res = await fetch(`${base()}/mpesa/c2b/v1/registerurl`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ShortCode: config.mpesa.shortcode,
      ResponseType: 'Completed',
      ConfirmationURL: callbackUrl('c2b'),
      ValidationURL: callbackUrl('c2b-validate'),
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.errorMessage || `C2B register failed (${res.status})`);
  return json;
}

/** Pull the useful fields out of an STK callback body. */
export function parseStkCallback(body) {
  const cb = body?.Body?.stkCallback;
  if (!cb) return null;
  const items = {};
  for (const it of cb.CallbackMetadata?.Item || []) items[it.Name] = it.Value;
  return {
    checkoutRequestId: cb.CheckoutRequestID,
    resultCode: Number(cb.ResultCode),
    resultDesc: cb.ResultDesc,
    amount: items.Amount != null ? Math.round(Number(items.Amount)) : null,
    receipt: items.MpesaReceiptNumber || null,
    phone: items.PhoneNumber ? String(items.PhoneNumber) : null,
  };
}
