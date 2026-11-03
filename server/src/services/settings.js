import { config } from '../config.js';
import { pool, many } from '../db.js';

// Every setting an admin can change. `path` is where it lives on `config`.
// Values saved in the database override the .env defaults.
export const FIELDS = [
  { key: 'businessName', group: 'store', path: 'businessName', label: 'Shop name' },
  { key: 'shopLocation', group: 'store', path: 'shopLocation', label: 'Collection point', hint: 'Used in messages, e.g. "our Nairobi shop"' },
  { key: 'collectionTitle', group: 'store', path: 'collectionTitle', label: 'Product list heading', hint: 'Shown above the products, e.g. "Available for preorder"' },
  { key: 'storeHeadline', group: 'store', path: 'storeHeadline', label: 'Banner headline' },
  { key: 'storeTagline', group: 'store', path: 'storeTagline', label: 'Banner text', long: true },
  { key: 'paybillNumber', group: 'store', path: 'paybillNumber', label: 'Paybill / Till number' },

  { key: 'smsProvider', group: 'sms', path: 'sms.provider', label: 'SMS provider', options: [['console', 'Off (log only)'], ['blessedtexts', 'BlessedTexts'], ['africastalking', "Africa's Talking"]] },
  { key: 'blessedApiKey', group: 'sms', path: 'sms.blessedApiKey', label: 'BlessedTexts API key', secret: true },
  { key: 'blessedSenderId', group: 'sms', path: 'sms.blessedSenderId', label: 'BlessedTexts sender ID' },
  { key: 'blessedEndpoint', group: 'sms', path: 'sms.blessedEndpoint', label: 'BlessedTexts send URL', hint: 'Only change if BlessedTexts gives you a different URL' },
  { key: 'atUsername', group: 'sms', path: 'sms.username', label: "Africa's Talking username" },
  { key: 'atApiKey', group: 'sms', path: 'sms.apiKey', label: "Africa's Talking API key", secret: true },
  { key: 'atSenderId', group: 'sms', path: 'sms.senderId', label: "Africa's Talking sender ID" },
  { key: 'atSandbox', group: 'sms', path: 'sms.sandbox', label: "Africa's Talking sandbox mode", bool: true },

  { key: 'emailEnabled', group: 'email', path: 'email.enabled', label: 'Send emails', bool: true, hint: 'Customers with an email address get every notification by email too' },
  { key: 'brevoApiKey', group: 'email', path: 'email.brevoApiKey', label: 'Brevo API key', secret: true },
  { key: 'emailSenderName', group: 'email', path: 'email.senderName', label: 'Sender name' },
  { key: 'emailSenderEmail', group: 'email', path: 'email.senderEmail', label: 'Sender email', hint: 'Must be a verified sender in Brevo' },
  { key: 'emailReplyTo', group: 'email', path: 'email.replyTo', label: 'Reply-to email (optional)' },

  { key: 'paymentProvider', group: 'payments', path: 'payments.provider', label: 'How customers pay', options: [['mock', 'Test mode (payments succeed automatically)'], ['daraja', 'M-Pesa Daraja (Safaricom direct)'], ['sunpay', 'SunPay']] },
  { key: 'publicApiUrl', group: 'payments', path: 'publicApiUrl', label: 'Public website address', hint: 'Payment results are sent back to this address. It must be https and reachable from the internet.' },
  { key: 'mpesaMode', group: 'payments', path: 'mpesa.mode', label: 'Daraja environment', options: [['sandbox', 'Sandbox (testing)'], ['production', 'Production (real money)']] },
  { key: 'mpesaShortcode', group: 'payments', path: 'mpesa.shortcode', label: 'Shortcode (Paybill or Till)' },
  { key: 'mpesaTransactionType', group: 'payments', path: 'mpesa.transactionType', label: 'Shortcode type', options: [['CustomerPayBillOnline', 'Paybill'], ['CustomerBuyGoodsOnline', 'Till (Buy Goods)']] },
  { key: 'mpesaConsumerKey', group: 'payments', path: 'mpesa.consumerKey', label: 'Consumer key', secret: true },
  { key: 'mpesaConsumerSecret', group: 'payments', path: 'mpesa.consumerSecret', label: 'Consumer secret', secret: true },
  { key: 'mpesaPasskey', group: 'payments', path: 'mpesa.passkey', label: 'Passkey', secret: true },
  { key: 'mpesaCallbackSecret', group: 'payments', path: 'mpesa.callbackSecret', label: 'Callback secret', secret: true, hint: 'A long random text. It becomes part of the callback addresses, so keep it private.' },
  { key: 'sunpayApiKey', group: 'payments', path: 'payments.sunpayApiKey', label: 'SunPay API key', secret: true, hint: 'Starts with sp_' },
  { key: 'sunpayBaseUrl', group: 'payments', path: 'payments.sunpayBaseUrl', label: 'SunPay API address' },
  { key: 'sunpayWebhookSecret', group: 'payments', path: 'payments.sunpayWebhookSecret', label: 'SunPay webhook secret (optional)', secret: true, hint: 'Only needed if you register a signed webhook in SunPay' },
  { key: 'sunpaySettleType', group: 'payments', path: 'payments.settleType', label: 'Forward money to', options: [['none', 'Keep in SunPay'], ['till', 'A Till'], ['paybill', 'A Paybill']] },
  { key: 'sunpaySettleShortcode', group: 'payments', path: 'payments.settleShortcode', label: 'Till / Paybill number' },
  { key: 'sunpaySettleAccount', group: 'payments', path: 'payments.settleAccount', label: 'Paybill account reference' },
];
const BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
const setPath = (o, p, v) => {
  const ks = p.split('.');
  const last = ks.pop();
  ks.reduce((a, k) => a[k], o)[last] = v;
};

// Snapshot of the .env defaults, taken before any database value is applied
const DEFAULTS = Object.fromEntries(FIELDS.map((f) => [f.key, getPath(config, f.path)]));

let stored = {};

function apply() {
  for (const f of FIELDS) {
    const v = f.key in stored ? stored[f.key] : DEFAULTS[f.key];
    setPath(config, f.path, v);
  }
}

export async function loadSettings() {
  const rows = await many('SELECT key, value FROM settings');
  stored = Object.fromEntries(rows.filter((r) => BY_KEY[r.key]).map((r) => [r.key, r.value]));
  apply();
}

export function callbackUrls() {
  const base = String(config.publicApiUrl || '').replace(/\/$/, '');
  return {
    darajaStk: `${base}/api/webhooks/mpesa/stk/${config.mpesa.callbackSecret}`,
    darajaC2b: `${base}/api/webhooks/mpesa/c2b/${config.mpesa.callbackSecret}`,
    sunpay: `${base}/api/webhooks/sunpay/${config.mpesa.callbackSecret}`,
    sunpaySigned: `${base}/api/webhooks/sunpay`,
  };
}

const mask = (v) => (v ? '••••••' + String(v).slice(-4) : '');

// Settings for the admin screen: secrets are never sent back, only a hint that they are set
export function settingsForAdmin() {
  return FIELDS.map((f) => {
    const v = getPath(config, f.path);
    const { path, ...meta } = f;
    return { ...meta, value: f.secret ? '' : v, isSet: f.secret ? !!v : undefined, hint2: f.secret ? mask(v) : undefined, fromDb: f.key in stored };
  });
}

// changes: { key: value }. For secrets an empty value means "keep"; null means "clear".
export async function saveSettings(changes) {
  for (const [key, raw] of Object.entries(changes)) {
    const f = BY_KEY[key];
    if (!f) continue;
    if (f.secret && raw === '') continue;
    if (raw === null) {
      await pool.query('DELETE FROM settings WHERE key = $1', [key]);
      delete stored[key];
      continue;
    }
    let v = raw;
    if (f.bool) v = raw === true || raw === 'true';
    else v = String(raw ?? '').trim();
    if (f.options && !f.options.some(([o]) => o === v)) throw Object.assign(new Error(`Invalid value for ${f.label}`), { status: 400 });
    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(v)]
    );
    stored[key] = v;
  }
  apply();
}
