import { Router } from 'express';
import { config } from '../config.js';
import { one, query } from '../db.js';
import { sendSms } from '../services/sms.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { ah, bad, normalizePhone, randomDigits, sha256 } from '../util.js';

const r = Router();

r.post('/request-otp', ah(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (!phone) throw bad('Enter a valid Safaricom/Airtel number, e.g. 0712345678');

  const recent = await one(
    `SELECT COUNT(*)::int AS n FROM otp_codes WHERE phone = $1 AND created_at > now() - interval '15 minutes'`,
    [phone]
  );
  if (recent.n >= 5) throw bad('Too many codes requested. Try again in 15 minutes.');

  const code = randomDigits(6);
  await query(
    `INSERT INTO otp_codes (phone, code_hash, expires_at) VALUES ($1, $2, now() + interval '10 minutes')`,
    [phone, sha256(`${phone}:${code}`)]
  );
  const user = await one('SELECT id FROM users WHERE phone = $1', [phone]);
  await sendSms({ userId: user?.id, phone, body: `Your ${config.businessName} login code is ${code}. It expires in 10 minutes.` }, 'otp');

  res.json({ ok: true, isNew: !user, ...(config.sms.provider === 'console' ? { devCode: code } : {}) });
}));

r.post('/verify-otp', ah(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const code = String(req.body.code || '').trim();
  if (!phone || !code) throw bad('Enter your phone number and the code');

  const otp = await one(
    `SELECT * FROM otp_codes WHERE phone = $1 AND used_at IS NULL AND expires_at > now()
      ORDER BY id DESC LIMIT 1`,
    [phone]
  );
  if (!otp) throw bad('Code expired. Request a new one.');
  if (otp.attempts >= 5) throw bad('Too many wrong attempts. Request a new code.');
  if (otp.code_hash !== sha256(`${phone}:${code}`)) {
    await query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [otp.id]);
    throw bad('Wrong code');
  }
  await query('UPDATE otp_codes SET used_at = now() WHERE id = $1', [otp.id]);

  const name = String(req.body.name || '').trim() || null;
  let user = await one('SELECT * FROM users WHERE phone = $1', [phone]);
  if (!user) {
    user = await one(`INSERT INTO users (phone, name) VALUES ($1, $2) RETURNING *`, [phone, name]);
  } else if (name && !user.name) {
    user = await one(`UPDATE users SET name = $2 WHERE id = $1 RETURNING *`, [user.id, name]);
  }
  res.json({
    token: signToken(user),
    user: { id: user.id, name: user.name, phone: user.phone, email: user.email, role: user.role, sms_opt_in: user.sms_opt_in },
  });
}));

r.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

r.patch('/me', requireAuth, ah(async (req, res) => {
  const { name, email, sms_opt_in } = req.body;
  const user = await one(
    `UPDATE users SET
        name = COALESCE($2, name),
        email = COALESCE($3, email),
        sms_opt_in = COALESCE($4, sms_opt_in)
      WHERE id = $1 RETURNING id, name, phone, email, role, sms_opt_in`,
    [req.user.id, name?.trim() || null, email?.trim() || null, typeof sms_opt_in === 'boolean' ? sms_opt_in : null]
  );
  res.json({ user });
}));

export default r;
