import { ask } from '../../components/Dialogs.jsx';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useApi, useAction } from '../../hooks.js';
import { useAuth } from '../../auth.jsx';
import { kes, date, phone, STAGE_LABEL, PAYMENT_LABEL } from '../../format.js';
import { PayBadge, Err, Loading } from '../../components/ui.jsx';

function OrderDrawer({ id, onClose, onChanged }) {
  const { user } = useAuth();
  const { data, error, loading, reload } = useApi(`/admin/orders/${id}`);
  const { busy, error: err, run } = useAction();

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const markRefunded = async () => {
    if (!(await ask('Have you sent the refund to the customer?', { confirmLabel: 'Mark refund sent' }))) return;
    run(async () => { await api(`/admin/orders/${id}/refunded`, { method: 'POST', body: {} }); await reload(); onChanged(); });
  };

  return (
    <>
      <div className="drawer-bg" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Order details">
        <div className="spread" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{data ? `Order ${data.order.order_no}` : 'Order'}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>
        {loading && !data ? <Loading /> : error ? <Err msg={error} /> : (() => {
          const o = data.order;
          return (
            <div className="stack">
              <Err msg={err} />
              <div className="panel">
                <dl className="kv">
                  <dt>Customer</dt><dd>{o.customer_name || '—'}, {phone(o.customer_phone)}</dd>
                  <dt>Round</dt><dd>{o.period_name} ({STAGE_LABEL[o.period_status]})</dd>
                  <dt>Placed</dt><dd>{date(o.created_at, true)}</dd>
                  <dt>Payment</dt><dd><PayBadge order={o} /></dd>
                  <dt>Total</dt><dd className="num">{kes(o.total_kes)}</dd>
                  <dt>Paid</dt><dd className="num">{kes(o.paid_kes)}</dd>
                  {o.refund_due_kes > 0 && <><dt>Refund due</dt><dd className="num"><b>{kes(o.refund_due_kes)}</b></dd></>}
                  {o.collected_at && <><dt>Collected</dt><dd>{date(o.collected_at, true)} by {o.collected_by_name}{o.collected_by_phone ? `, ${phone(o.collected_by_phone)}` : ''}</dd></>}
                </dl>
                {o.refund_due_kes > 0 && user.role === 'admin' && (
                  <button className="btn btn-sm" style={{ marginTop: 14 }} onClick={markRefunded} disabled={busy}>Mark refund sent</button>
                )}
              </div>
              <div className="panel">
                <h3>Items</h3>
                {o.items.map((it) => (
                  <div className="line" key={it.id} style={it.status === 'cancelled' ? { opacity: .55 } : undefined}>
                    <div className="line-name">{it.product_name}{it.status === 'cancelled' && <> <span className="badge badge-bad">Cancelled</span></>}<div className="small muted">{it.qty} × {kes(it.unit_price_kes)}</div></div>
                    <span className="num">{kes(it.qty * it.unit_price_kes)}</span>
                  </div>
                ))}
              </div>
              {o.payments.length > 0 && (
                <div className="panel">
                  <h3>Payment attempts</h3>
                  {o.payments.map((p) => (
                    <div className="line" key={p.id}>
                      <div className="line-name small">{p.mpesa_receipt || p.method}<div className="muted">{date(p.created_at, true)} · {p.status}{p.result_desc && p.status !== 'approved' ? ` (${p.result_desc})` : ''}</div></div>
                      <span className="num">{kes(p.amount_kes)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
      </aside>
    </>
  );
}

export default function AdminOrders() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const [openId, setOpenId] = useState(null);
  const status = params.get('status') || '';
  const periodId = params.get('periodId') || '';
  const qs = new URLSearchParams({ ...(status && { status }), ...(periodId && { periodId }), ...(params.get('q') && { q: params.get('q') }) }).toString();
  const { data, error, loading, reload } = useApi(`/admin/orders?${qs}`);
  const periods = useApi('/admin/periods');

  const update = (k, v) => {
    const p = Object.fromEntries(params);
    if (v) p[k] = v; else delete p[k];
    setParams(p);
  };

  return (
    <div className="stack">
      <h1>Orders</h1>
      <div className="panel">
        <form className="form-row" onSubmit={(e) => { e.preventDefault(); update('q', q.trim()); }}>
          <label className="field"><span>Search</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order no, name or phone" /></label>
          <label className="field"><span>Payment</span>
            <select value={status} onChange={(e) => update('status', e.target.value)}>
              <option value="">Any</option>
              {Object.entries(PAYMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              <option value="collected">Collected</option>
            </select>
          </label>
          {periods.data?.periods && (
            <label className="field"><span>Round</span>
              <select value={periodId} onChange={(e) => update('periodId', e.target.value)}>
                <option value="">All rounds</option>
                {periods.data.periods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
        </form>

        {loading && !data ? <Loading /> : error ? <Err msg={error} /> : !data.orders.length ? <div className="empty"><p>No orders match.</p></div> : (
          <>
            <p className="small muted">{data.orders.length} order{data.orders.length === 1 ? '' : 's'}</p>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Order</th><th>Customer</th><th>Round</th><th>Payment</th><th className="num">Total</th><th className="num">Paid</th></tr></thead>
                <tbody>
                  {data.orders.map((o) => (
                    <tr key={o.id} className="clickable" onClick={() => setOpenId(o.id)}>
                      <td><b>{o.order_no}</b><div className="small muted">{date(o.created_at)}</div></td>
                      <td>{o.customer_name || '—'}<div className="small muted">{phone(o.customer_phone)}</div></td>
                      <td className="small">{o.period_name}<div className="muted">{STAGE_LABEL[o.period_status]}</div></td>
                      <td><PayBadge order={o} />{o.refund_due_kes > 0 && <div className="small muted">Refund {kes(o.refund_due_kes)}</div>}</td>
                      <td className="num">{kes(o.total_kes)}</td>
                      <td className="num">{kes(o.paid_kes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      {openId && <OrderDrawer id={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </div>
  );
}
