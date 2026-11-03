import crypto from 'node:crypto';

// Normalise Kenyan phone numbers to 2547XXXXXXXX / 2541XXXXXXXX
export function normalizePhone(input) {
  if (!input) return null;
  let p = String(input).replace(/[\s\-()+]/g, '');
  if (/^0[17]\d{8}$/.test(p)) p = '254' + p.slice(1);
  else if (/^[17]\d{8}$/.test(p)) p = '254' + p;
  if (!/^254[17]\d{8}$/.test(p)) return null;
  return p;
}

// 0712 345 678 style for display
export function displayPhone(p) {
  if (!p) return '';
  return p.startsWith('254') ? '0' + p.slice(3) : p;
}

export function maskPhone(p) {
  const d = displayPhone(p);
  return d.length >= 10 ? d.slice(0, 4) + 'xxx' + d.slice(7) : d;
}

export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

export const randomDigits = (n) => {
  let s = '';
  for (let i = 0; i < n; i++) s += crypto.randomInt(0, 10);
  return s;
};

export const kes = (n) => 'KES ' + Number(n || 0).toLocaleString('en-KE');

export function fmtDate(d) {
  if (!d) return '';
  const date = typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T12:00:00') : new Date(d);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi' });
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const bad = (msg) => new HttpError(400, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);

// Wrap async route handlers so thrown errors reach the error middleware
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const int = (v) => {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};

// Pipeline stages a shipping period moves through after it closes
export const STAGES = [
  'draft', 'open', 'closed', 'supplier_dispatching', 'warehouse_received',
  'in_transit', 'ready_for_collection', 'completed',
];

export const STAGE_LABELS = {
  draft: 'Draft',
  open: 'Open for orders',
  closed: 'Orders closed',
  supplier_dispatching: 'Supplier dispatching',
  warehouse_received: 'Received at warehouse',
  in_transit: 'In transit',
  ready_for_collection: 'Ready for collection',
  completed: 'Completed',
};
