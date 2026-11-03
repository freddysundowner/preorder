import { config } from '../config.js';
import { pool } from '../db.js';
import { emailCopies } from './email.js';

const AT_URL = () =>
  config.sms.sandbox
    ? 'https://api.sandbox.africastalking.com/version1/messaging'
    : 'https://api.africastalking.com/version1/messaging';

async function sendViaAfricasTalking(phones, body) {
  const params = new URLSearchParams({
    username: config.sms.username,
    to: phones.map((p) => '+' + p).join(','),
    message: body,
  });
  if (config.sms.senderId) params.set('from', config.sms.senderId);
  const res = await fetch(AT_URL(), {
    method: 'POST',
    headers: {
      apiKey: config.sms.apiKey,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Africa's Talking error ${res.status}: ${JSON.stringify(json)}`);
  const recipients = json?.SMSMessageData?.Recipients || [];
  const byPhone = {};
  for (const r of recipients) byPhone[String(r.number).replace('+', '')] = r;
  return byPhone;
}

const SUBJECTS = {
  invoice: 'Your order has been received', payment_received: 'Payment received', closing_reminder: 'Orders close soon',
  unpaid_cancelled: 'Your order was cancelled', product_cancelled: 'An item in your order was cancelled',
  ready_for_collection: 'Your order is ready for collection', collected: 'Order collected', delivered: 'Order delivered', period_opened: 'Preorders are open',
  order_cancelled: 'Your order was cancelled', status_supplier_dispatching: 'Your order has been dispatched',
  status_warehouse_received: 'Your order reached our warehouse', status_in_transit: 'Your order is on the way',
};
const subjectFor = (t) => `${config.businessName}: ${SUBJECTS[t] || 'Order update'}`;

// BlessedTexts: one request per recipient
async function sendViaBlessedTexts(phones, body) {
  const out = {};
  for (const phone of phones) {
    try {
      const res = await fetch(config.sms.blessedEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ api_key: config.sms.blessedApiKey, sender_id: config.sms.blessedSenderId, message: body, phone }),
      });
      const json = await res.json().catch(() => ({}));
      const code = json.status_code ?? json.statusCode;
      const ok = res.ok && (code === undefined || String(code) === '1000');
      out[phone] = ok
        ? { status: 'Success', messageId: String(json.message_id ?? json.messageId ?? json.id ?? '') || null }
        : { status: 'Failed', error: json.status_desc || json.message || `HTTP ${res.status}` };
    } catch (e) {
      out[phone] = { status: 'Failed', error: e.message };
    }
  }
  return out;
}

/**
 * Send SMS messages. Messages with identical text are grouped into one bulk request.
 * @param {Array<{userId?:number, phone:string, body:string}>} messages
 * @param {string} template  short name for the SMS log, e.g. 'payment_approved'
 */
export async function sendSms(messages, template) {
  const list = (Array.isArray(messages) ? messages : [messages]).filter((m) => m && m.phone && m.body);
  if (!list.length) return;

  const groups = new Map();
  for (const m of list) {
    if (!groups.has(m.body)) groups.set(m.body, []);
    groups.get(m.body).push(m);
  }

  for (const [body, group] of groups) {
    // Africa's Talking accepts many recipients per request; chunk to stay well within limits
    for (let i = 0; i < group.length; i += 500) {
      const chunk = group.slice(i, i + 500);
      let results = {};
      let failed = null;
      if (config.sms.provider === 'blessedtexts') {
        results = await sendViaBlessedTexts(chunk.map((m) => m.phone), body);
      } else if (config.sms.provider === 'africastalking') {
        try {
          results = await sendViaAfricasTalking(chunk.map((m) => m.phone), body);
        } catch (e) {
          failed = e.message;
          console.error('[sms] send failed:', e.message);
        }
      } else {
        for (const m of chunk) console.log(`[sms:${template}] to ${m.phone}: ${body}`);
      }
      for (const m of chunk) {
        const r = results[m.phone];
        await pool.query(
          `INSERT INTO sms_messages (user_id, phone, template, body, provider_id, status, cost, error)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            m.userId || null, m.phone, template, body,
            r?.messageId || null,
            failed ? 'failed' : r ? r.status : config.sms.provider === 'console' ? 'logged' : 'sent',
            r?.cost || null,
            failed || r?.error || null,
          ]
        );
      }
    }
  }
  await emailCopies(list, template, subjectFor);
}

// Fire-and-forget wrapper: never let an SMS failure break the main request
export function sendSmsLater(messages, template) {
  sendSms(messages, template).catch((e) => console.error('[sms] error:', e));
}
