import { ask } from '../../components/Dialogs.jsx';
import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, download } from '../../api.js';
import { useApi, useAction } from '../../hooks.js';
import { kes, date, toLocalInput, fromLocalInput, STAGE_LABEL } from '../../format.js';
import ImageField from '../../components/ImageField.jsx';
import { Err, Ok, Loading, ProductImage } from '../../components/ui.jsx';

const FLOW = ['open', 'closed', 'in_transit', 'ready_for_collection', 'completed'];
const NEXT_ACTION = {
  open: 'Close orders now',
  closed: 'Mark goods on the way',
  in_transit: 'Goods arrived: ready for pickup',
  ready_for_collection: 'Mark round completed',
};
const NEXT_WARNING = {
  closed: 'Unpaid orders will be cancelled and those customers told by SMS.',
  in_transit: 'Every paid customer in this round gets an SMS.',
  ready_for_collection: 'Each paid customer gets an SMS with their own pickup code.',
  completed: 'No SMS is sent. The round also finishes by itself once every paid order is collected.',
};

const blankProduct = { name: '', description: '', price_kes: '', image_url: '', min_qty: '', max_qty: '' };

function ProductForm({ initial, onSave, onCancel, busy }) {
  const [f, setF] = useState(initial);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(f); }} style={{ background: '#f6f8fa', padding: 16, borderRadius: 8, marginBottom: 12 }}>
      <div className="form-row">
        <label className="field"><span>Product name</span><input value={f.name} onChange={set('name')} required /></label>
        <label className="field"><span>Price (KES)</span><input type="number" min="1" value={f.price_kes} onChange={set('price_kes')} required /></label>
      </div>
      <label className="field"><span>Description</span><input value={f.description || ''} onChange={set('description')} /></label>
      <ImageField value={f.image_url} name={f.name} onChange={(v) => set('image_url')({ target: { value: v } })} />
      <div className="form-row">
        <label className="field"><span>Supplier minimum</span><input type="number" min="1" value={f.min_qty || ''} onChange={set('min_qty')} /><small>Total units needed across all orders</small></label>
        <label className="field"><span>Max per order</span><input type="number" min="1" value={f.max_qty || ''} onChange={set('max_qty')} /></label>
      </div>
      <div className="row">
        <button className="btn btn-sm" disabled={busy}>Save product</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export default function PeriodDetail() {
  const { id } = useParams();
  const { data, error, loading, reload } = useApi(`/admin/periods/${id}`);
  const { busy, error: err, setError, run } = useAction();
  const [msg, setMsg] = useState(null);
  const [editing, setEditing] = useState(null); // product id, 'new', or null
  const [stageNote, setStageNote] = useState('');
  const [eta, setEta] = useState(null);
  const [editPeriod, setEditPeriod] = useState(null);

  if (loading && !data) return <Loading />;
  if (error) return <Err msg={error} />;
  const { period, products, events, stats } = data;
  const idx = FLOW.indexOf(period.status);
  const next = FLOW[idx + 1];
  const canEditProducts = period.status === 'open';
  const etaValue = eta ?? (period.eta_date || '');

  const act = (fn, okMsg) => { setMsg(null); return run(async () => { await fn(); setMsg(okMsg); await reload(); }); };

  const moveTo = async (status) => {
    if (!(await ask(`${NEXT_ACTION[period.status]}?\n\n${NEXT_WARNING[status]}`, { confirmLabel: NEXT_ACTION[period.status], danger: status === 'closed' }))) return;
    act(() => api(`/admin/periods/${id}/status`, { method: 'POST', body: { status, eta_date: etaValue || null, note: stageNote || null } }),
      `Moved to "${STAGE_LABEL[status]}"`);
    setStageNote('');
  };

  const updateEta = () => act(
    () => api(`/admin/periods/${id}/status`, { method: 'POST', body: { status: period.status, eta_date: etaValue || null, note: stageNote || null } }),
    FLOW.indexOf(period.status) >= 3 ? 'Arrival date updated and customers notified' : 'Arrival date updated'
  );

  const saveProduct = (f) => act(async () => {
    if (editing === 'new') await api('/admin/products', { method: 'POST', body: { ...f, period_id: period.id } });
    else await api(`/admin/products/${editing}`, { method: 'PATCH', body: f });
    setEditing(null);
  }, 'Product saved');

  const cancelProduct = async (p) => {
    if (!(await ask(`Cancel ${p.name}? It will be removed from all orders, customers get an SMS and refunds are recorded for paid orders.`, { confirmLabel: 'Cancel product', danger: true }))) return;
    act(() => api(`/admin/products/${p.id}/cancel`, { method: 'POST' }), `${p.name} cancelled`);
  };
  const deleteProduct = async (p) => {
    if (!(await ask(`Delete ${p.name}?`, { confirmLabel: 'Delete', danger: true }))) return;
    act(() => api(`/admin/products/${p.id}`, { method: 'DELETE' }), 'Product deleted');
  };

  const savePeriod = (e) => {
    e.preventDefault();
    act(async () => {
      await api(`/admin/periods/${id}`, { method: 'PATCH', body: {
        name: editPeriod.name, opens_at: fromLocalInput(editPeriod.opens_at), closes_at: fromLocalInput(editPeriod.closes_at),
        eta_date: editPeriod.eta_date || null } });
      setEditPeriod(null);
    }, 'Round updated');
  };

  return (
    <div className="stack">
      <div>
        <Link to="/admin/periods" className="small">Shipping rounds</Link>
        <div className="spread">
          <h1 style={{ margin: '4px 0' }}>{period.name}</h1>
          {!editPeriod && <button className="btn btn-ghost btn-sm" onClick={() => setEditPeriod({ name: period.name, opens_at: toLocalInput(period.opens_at), closes_at: toLocalInput(period.closes_at), eta_date: period.eta_date || '' })}>Edit details</button>}
        </div>
        <p className="muted" style={{ margin: 0 }}>Opens {date(period.opens_at, true)} · closes {date(period.closes_at, true)}</p>
      </div>

      <Ok msg={msg} />
      <Err msg={err} />

      {editPeriod && (
        <form className="panel" onSubmit={savePeriod}>
          <label className="field"><span>Name</span><input value={editPeriod.name} onChange={(e) => setEditPeriod({ ...editPeriod, name: e.target.value })} required /></label>
          <div className="form-row">
            <label className="field"><span>Opens</span><input type="datetime-local" value={editPeriod.opens_at} onChange={(e) => setEditPeriod({ ...editPeriod, opens_at: e.target.value })} /></label>
            <label className="field"><span>Closes</span><input type="datetime-local" value={editPeriod.closes_at} onChange={(e) => setEditPeriod({ ...editPeriod, closes_at: e.target.value })} /></label>
          </div>
          <div className="row"><button className="btn btn-sm" disabled={busy}>Save</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditPeriod(null)}>Cancel</button></div>
        </form>
      )}

      <section className="panel">
        <h2>Status</h2>
        <div className="stage-mover" style={{ marginBottom: 16 }}>
          {FLOW.map((s, i) => (
            <span key={s} className={`stage-chip ${i < idx ? 'done' : i === idx ? 'now' : ''}`}>{STAGE_LABEL[s]}</span>
          ))}
        </div>
        <div className="form-row">
          <label className="field">
            <span>Expected arrival in Nairobi</span>
            <input type="date" value={etaValue} onChange={(e) => setEta(e.target.value)} />
          </label>
          <label className="field">
            <span>Note to customers (optional)</span>
            <input value={stageNote} maxLength={160} onChange={(e) => setStageNote(e.target.value)} placeholder="Added to the SMS" />
          </label>
        </div>
        <div className="row">
          {next && <button className={`btn ${next === 'closed' ? 'btn-danger' : ''}`} onClick={() => moveTo(next)} disabled={busy}>{NEXT_ACTION[period.status]}</button>}
          {etaValue !== (period.eta_date || '') && <button className="btn btn-ghost" onClick={updateEta} disabled={busy}>Update arrival date</button>}
          {period.status === 'open' && (
            <button className="btn btn-ghost" disabled={busy} onClick={() => act(async () => {
              const r = await api(`/admin/periods/${id}/remind`, { method: 'POST' }); setError(null); return r;
            }, 'Payment reminder sent to customers with unpaid orders or full carts')}>Send payment reminder</button>
          )}
        </div>
        {next && <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>{NEXT_WARNING[next]}</p>}
      </section>

      <div className="stats">
        <div className="stat"><div className="v">{stats.orders}</div><div className="k">Orders</div></div>
        <div className="stat"><div className="v">{stats.paid}</div><div className="k">Paid</div></div>
        <div className="stat"><div className="v">{stats.unpaid}</div><div className="k">Awaiting payment</div></div>
        <div className="stat"><div className="v num">{kes(stats.paid_kes)}</div><div className="k">Paid value</div></div>
        <div className="stat"><div className="v">{stats.collected}</div><div className="k">Collected</div></div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Products</h2>
          <div className="row">
            <button className="btn btn-ghost btn-sm" onClick={() => download(`/admin/periods/${id}/supplier-summary?format=csv`, `supplier-order-${period.name}.csv`)}>Download supplier order</button>
            {canEditProducts && editing !== 'new' && <button className="btn btn-sm" onClick={() => setEditing('new')}>Add product</button>}
          </div>
        </div>
        {editing === 'new' && <ProductForm initial={blankProduct} busy={busy} onSave={saveProduct} onCancel={() => setEditing(null)} />}
        {!products.length && editing !== 'new' && <p className="muted">No products yet.</p>}
        {products.map((p) => editing === p.id ? (
          <ProductForm key={p.id} initial={p} busy={busy} onSave={saveProduct} onCancel={() => setEditing(null)} />
        ) : (
          <div className="line" key={p.id} style={p.status === 'cancelled' ? { opacity: .55 } : undefined}>
            <ProductImage src={p.image_url} name={p.name} className="thumb" />
            <div className="line-name">
              <b>{p.name}</b> {p.status === 'cancelled' && <span className="badge badge-bad">Cancelled</span>}
              <div className="small muted num">
                {kes(p.price_kes)} · paid {p.paid_qty}{p.unpaid_qty ? `, unpaid ${p.unpaid_qty}` : ''}
                {p.min_qty ? ` · minimum ${p.min_qty}` : ''}
              </div>
              {p.min_qty && p.status === 'active' && (
                <div className="row small" style={{ marginTop: 4, gap: 8 }}>
                  <div className="bar" style={{ width: 120 }}><i style={{ width: `${Math.min(100, (p.paid_qty / p.min_qty) * 100)}%`, background: p.paid_qty >= p.min_qty ? 'var(--green)' : undefined }} /></div>
                  <span className={p.paid_qty >= p.min_qty ? '' : 'muted'}>{p.paid_qty >= p.min_qty ? 'Minimum reached' : `${p.min_qty - p.paid_qty} more needed`}</span>
                </div>
              )}
            </div>
            {p.status === 'active' && (
              <div className="row" style={{ gap: 6 }}>
                {canEditProducts && <button className="btn btn-ghost btn-sm" onClick={() => setEditing(p.id)}>Edit</button>}
                {p.paid_qty + p.unpaid_qty > 0
                  ? <button className="btn btn-danger btn-sm" onClick={() => cancelProduct(p)} disabled={busy}>Cancel</button>
                  : canEditProducts && <button className="btn btn-danger btn-sm" onClick={() => deleteProduct(p)} disabled={busy}>Delete</button>}
              </div>
            )}
          </div>
        ))}
      </section>

      <section className="panel">
        <div className="panel-head"><h2>History</h2><Link className="small" to={`/admin/orders?periodId=${id}`}>See orders in this round</Link></div>
        {!events.length ? <p className="muted">No status changes yet.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>When</th><th>Status</th><th>Arrival</th><th>Note</th><th>By</th></tr></thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td>{date(e.created_at, true)}</td>
                    <td>{STAGE_LABEL[e.status]}</td>
                    <td>{e.eta_date ? date(e.eta_date) : '—'}</td>
                    <td>{e.note || '—'}</td>
                    <td>{e.by_name || 'System'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
