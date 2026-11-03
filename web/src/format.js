export const kes = (n) => 'KES ' + Number(n || 0).toLocaleString('en-KE');

export const phone = (p) => (p && p.startsWith('254') ? '0' + p.slice(3) : p || '');

const TZ = { timeZone: 'Africa/Nairobi' };

export function date(d, withTime = false) {
  if (!d) return '';
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T12:00:00') : new Date(d);
  return dt.toLocaleString('en-GB', {
    ...TZ, day: 'numeric', month: 'short', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

export const shortDate = (d) => {
  if (!d) return '';
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T12:00:00') : new Date(d);
  return dt.toLocaleDateString('en-GB', { ...TZ, day: 'numeric', month: 'short' });
};

// For <input type="datetime-local"> values in Nairobi time
export function toLocalInput(d) {
  if (!d) return '';
  const dt = new Date(new Date(d).getTime() + 3 * 3600e3);
  return dt.toISOString().slice(0, 16);
}
export const fromLocalInput = (v) => (v ? new Date(v + ':00+03:00').toISOString() : null);

export const STAGES = [
  { key: 'open', label: 'Ordering open', short: 'Ordered' },
  { key: 'closed', label: 'Orders closed', short: 'Closed' },
  { key: 'in_transit', label: 'On the way', short: 'On the way' },
  { key: 'ready_for_collection', label: 'Ready for collection', short: 'Ready' },
];

export const STAGE_LABEL = {
  open: 'Open for orders', closed: 'Orders closed',
  in_transit: 'On the way', ready_for_collection: 'Ready for collection', completed: 'Completed',
};

export const PAYMENT_LABEL = {
  unpaid: 'Awaiting payment', paid: 'Paid', cancelled: 'Cancelled',
  refund_pending: 'Refund due', refunded: 'Refunded',
};

export function timeLeft(to) {
  const ms = new Date(to).getTime() - Date.now();
  if (ms <= 0) return null;
  const d = Math.floor(ms / 864e5);
  const h = Math.floor((ms % 864e5) / 36e5);
  const m = Math.floor((ms % 36e5) / 6e4);
  return { d, h, m, ms };
}
