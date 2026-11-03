import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { one } from '../db.js';

export const signToken = (user) => jwt.sign({ uid: user.id }, config.jwtSecret, { expiresIn: '30d' });

export async function requireAuth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Please log in' });
    const { uid } = jwt.verify(token, config.jwtSecret);
    const user = await one('SELECT id, name, phone, email, role, sms_opt_in FROM users WHERE id = $1', [uid]);
    if (!user) return res.status(401).json({ error: 'Please log in' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Session expired, please log in again' });
  }
}

// roles: 'admin' can do everything; 'staff' can do day-to-day shop work
export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !(req.user.role === 'admin' || roles.includes(req.user.role))) {
    return res.status(403).json({ error: 'Not allowed' });
  }
  next();
};

// Attaches req.user when a valid token is sent, but lets guests through
export async function optionalAuth(req, res, next) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return next();
  try {
    const { uid } = jwt.verify(h.slice(7), config.jwtSecret);
    req.user = await one('SELECT id, name, phone, email, role, sms_opt_in FROM users WHERE id = $1', [uid]);
  } catch { /* treat a bad token as a guest */ }
  next();
}
