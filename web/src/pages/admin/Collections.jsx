import { useState } from 'react';
import { api } from '../../api.js';
import { useAction } from '../../hooks.js';
import { date, phone } from '../../format.js';
import { Err, Ok } from '../../components/ui.jsx';

function ReleaseForm({ order, onDone }) {
  const [code, setCode] = useState('');
  const [same, setSame] = useState(true);
  const [name, setName] = useState(order.customer_name || '');
  const [ph, setPh] = useState(phone(order.customer_phone));
  const { busy, error, run } = useAction();

  const release = (e) => {
    e.preventDefault();
    run(async () => {
      await api('/admin/collections', {
        method: 'POST',
        body: { order_no: order.order_no, code, collected_by_name: same ? order.customer_name || 'Customer' : name, collected_by_phone: same ? order.customer_phone : ph },
      });
      onDone(`Order ${order.order_no} released. The customer has been sent a confirmation SMS.`);
    });
  };

  return (
    <form onSubmit={release} style={{ marginTop: 12 }}>
      <Err msg={error} />
      <label className="field">
        <span>Pickup code from the customer's SMS</span>
        <input className="otp-input" style={{ maxWidth: 240 }} inputMode="numeric" maxLength={6} value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required autoFocus />
      </label>
      <label className="check" style={{ marginBottom: 12 }}>
        <input type="checkbox" checked={same} onChange={(e) => setSame(e.target.checked)} />
        The customer is collecting in person
      </label>
      {!same && (
        <div className="form-row">
          <label className="field"><span>Collected by (name)</span><input value={name} onChange={(e) => setName(e.target.value)} required /></label>
          <label className="field"><span>Their phone</span><input type="tel" value={ph} onChange={(e) => setPh(e.target.value)} /></label>
        </div>
      )}
      <button className="btn" disabled={busy || code.length !== 6}>Release items</button>
    </form>
  );
}

export default function Collections() {
  const [q, setQ] = useState('');
  const [orders, setOrders] = useState(null);
  const [selected, setSelected] = useState(null);
  const [msg, setMsg] = useState(null);
  const { busy, error, run } = useAction();

  const search = (e) => {
    e?.preventDefault();
    setMsg(null); setSelected(null);
    run(async () => setOrders((await api(`/admin/collections/lookup?q=${encodeURIComponent(q.trim())}`)).orders));
  };

  return (
    <div className="stack page-narrow">
      <h1>Collection desk</h1>
      <Ok msg={msg} />
      <form className="panel row" onSubmit={search} style={{ alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: 1, marginBottom: 0, minWidth: 200 }}>
          <span>Customer phone or order number</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="0712 345 678 or PO1001" required autoFocus />
        </label>
        <button className="btn" disabled={busy}>Find</button>
      </form>
      <Err msg={error} />

      {orders && !orders.length && <div className="panel empty"><p>No paid orders found for "{q}".</p></div>}

      {orders?.map((o) => (
        <section className="panel" key={o.id}>
          <div className="spread">
            <div>
              <h2 style={{ margin: 0 }}>{o.order_no}</h2>
              <p className="muted small" style={{ margin: 0 }}>{o.customer_name}, {phone(o.customer_phone)} · {o.period_name}</p>
            </div>
            {o.collected_at
              ? <span className="badge">Collected</span>
              : o.ready ? <span className="badge badge-ok">Ready</span> : <span className="badge badge-warn">Not arrived</span>}
          </div>
          <ul style={{ margin: '12px 0 0', paddingLeft: '1.2em' }}>
            {(o.items || []).map((it, i) => <li key={i}>{it.qty} × {it.name}</li>)}
          </ul>
          {o.collected_at && <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>Collected {date(o.collected_at, true)} by {o.collected_by_name}.</p>}
          {o.ready && !o.collected_at && (
            selected === o.id
              ? <ReleaseForm order={o} onDone={(m) => { setMsg(m); setOrders(null); setSelected(null); setQ(''); }} />
              : <button className="btn" style={{ marginTop: 12 }} onClick={() => setSelected(o.id)}>Release this order</button>
          )}
        </section>
      ))}
    </div>
  );
}
