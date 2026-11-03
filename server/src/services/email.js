import { config } from '../config.js';
import { pool, one } from '../db.js';

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

export const emailReady = () => config.email.enabled && config.email.brevoApiKey && config.email.senderEmail;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function html(subject, body) {
  return `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#131921">
<h2 style="margin:0 0 16px">${esc(config.businessName)}</h2>
<p style="font-size:16px;line-height:1.5;white-space:pre-line">${esc(body)}</p>
<hr style="border:0;border-top:1px solid #e7e7e7;margin:24px 0"><p style="color:#767676;font-size:12px">${esc(subject)}</p></div>`;
}

async function brevo({ to, name, subject, body }) {
  const res = await fetch(BREVO_URL, {
    method: 'POST',
    headers: { 'api-key': config.email.brevoApiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: config.email.senderName || config.businessName, email: config.email.senderEmail },
      to: [{ email: to, ...(name ? { name } : {}) }],
      ...(config.email.replyTo ? { replyTo: { email: config.email.replyTo } } : {}),
      subject,
      htmlContent: html(subject, body),
      textContent: body,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Brevo error ${res.status}: ${json.message || JSON.stringify(json)}`);
  return json.messageId || null;
}

/** Send one email and record it in the log. Throws on failure only when `throwOnError`. */
export async function sendEmail({ userId, to, name, subject, body, template }, { throwOnError = false } = {}) {
  let status = 'sent', providerId = null, error = null;
  try {
    if (!emailReady()) throw new Error('Email is not set up (turn it on and add the Brevo key and sender in Settings)');
    providerId = await brevo({ to, name, subject, body });
  } catch (e) {
    status = 'failed'; error = e.message;
    console.error('[email] failed:', e.message);
  }
  await pool.query(
    `INSERT INTO email_messages (user_id, to_email, template, subject, body, provider_id, status, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [userId || null, to, template, subject, body, providerId, status, error]
  );
  if (status === 'failed' && throwOnError) throw new Error(error);
  return status === 'sent';
}

// Mirror SMS notifications by email for customers who have an address. Login codes stay SMS only.
export async function emailCopies(list, template, subjectFor) {
  if (!emailReady() || template === 'otp') return;
  for (const m of list) {
    if (!m.userId) continue;
    const u = await one('SELECT id, name, email FROM users WHERE id = $1', [m.userId]);
    if (!u?.email) continue;
    await sendEmail({ userId: u.id, to: u.email, name: u.name, subject: subjectFor(template), body: m.body, template });
  }
}
