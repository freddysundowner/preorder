import { PAYMENT_LABEL } from '../format.js';

export function PayBadge({ order }) {
  if (order.collected_at) return <span className="badge badge-ok">Collected</span>;
  if (order.payment_status === 'paid' && order.ready) return <span className="badge badge-ok">Ready to collect</span>;
  return <span className={`badge badge-${order.payment_status}`}>{PAYMENT_LABEL[order.payment_status]}</span>;
}

const ICONS = [
  [/fryer|oven|cooker|blender/i, '🍟'], [/earbud|headphone|speaker|audio/i, '🎧'], [/sneaker|shoe|boot/i, '👟'],
  [/handbag|purse/i, '👜'], [/bag|backpack/i, '🎒'], [/kettle|coffee|mug/i, '☕'], [/tripod|camera|phone/i, '📸'],
  [/vacuum|robot/i, '🤖'], [/power ?bank|charger|battery|solar/i, '🔋'], [/watch/i, '⌚'], [/shirt|dress|jacket|cloth/i, '👕'],
  [/lamp|light|torch/i, '💡'], [/toy|game/i, '🧸'],
];
const hue = (name = '') => { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

export function ProductImage({ src, name, className = 'product-img' }) {
  const icon = ICONS.find(([re]) => re.test(name || ''))?.[1];
  const h = hue(name);
  return (
    <div className={className} style={src ? undefined : { background: `linear-gradient(145deg, hsl(${h} 30% 95%), hsl(${(h + 20) % 360} 28% 90%))` }}>
      {src ? <img src={src} alt="" loading="lazy" /> : <span aria-hidden="true" className="ph">{icon || (name || '?').slice(0, 1)}</span>}
    </div>
  );
}

export function Qty({ value, onChange, max, disabled }) {
  return (
    <div className="qty">
      <button type="button" aria-label="Fewer" disabled={disabled || value <= 0} onClick={() => onChange(value - 1)}>−</button>
      <span aria-live="polite">{value}</span>
      <button type="button" aria-label="More" disabled={disabled || (max && value >= max)} onClick={() => onChange(value + 1)}>+</button>
    </div>
  );
}

export const Err = ({ msg }) => (msg ? <div className="alert alert-error" role="alert">{msg}</div> : null);
export const Ok = ({ msg }) => (msg ? <div className="alert alert-ok" role="status">{msg}</div> : null);

export function Loading() {
  return <p className="muted">Loading…</p>;
}
