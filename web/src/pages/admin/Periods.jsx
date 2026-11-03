import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { useApi, useAction } from '../../hooks.js';
import { kes, date, fromLocalInput, toLocalInput, STAGE_LABEL } from '../../format.js';
import { Err, Loading } from '../../components/ui.jsx';

export default function Periods() {
  const { data, error, loading } = useApi('/admin/periods');
  const [showNew, setShowNew] = useState(false);
  const nav = useNavigate();
  const now = Date.now();
  const [form, setForm] = useState({
    name: '', opens_at: toLocalInput(new Date(now)), closes_at: toLocalInput(new Date(now + 14 * 864e5)), eta_date: '',
  });
  const { busy, error: err, run } = useAction();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const create = (e) => {
    e.preventDefault();
    run(async () => {
      const { period } = await api('/admin/periods', {
        method: 'POST',
        body: { ...form, opens_at: fromLocalInput(form.opens_at), closes_at: fromLocalInput(form.closes_at), eta_date: form.eta_date || null },
      });
      nav(`/admin/periods/${period.id}`);
    });
  };

  if (loading) return <Loading />;
  if (error) return <Err msg={error} />;

  return (
    <div className="stack">
      <div className="spread">
        <h1 style={{ margin: 0 }}>Shipping rounds</h1>
        {!showNew && <button className="btn" onClick={() => setShowNew(true)}>New round</button>}
      </div>
      <p className="muted" style={{ marginTop: 4 }}>Each round has its own products and closing date, and ships as one batch.</p>

      {showNew && (
        <form className="panel" onSubmit={create}>
          <h2>New shipping round</h2>
          <Err msg={err} />
          <label className="field"><span>Name</span><input value={form.name} onChange={set('name')} placeholder="December shipment" required /></label>
          <div className="form-row">
            <label className="field"><span>Opens</span><input type="datetime-local" value={form.opens_at} onChange={set('opens_at')} required /></label>
            <label className="field"><span>Closes</span><input type="datetime-local" value={form.closes_at} onChange={set('closes_at')} required /></label>
            <label className="field"><span>Expected arrival (optional)</span><input type="date" value={form.eta_date} onChange={set('eta_date')} /></label>
          </div>
          <div className="row">
            <button className="btn" disabled={busy}>Create round</button>
            <button type="button" className="btn btn-ghost" onClick={() => setShowNew(false)}>Cancel</button>
          </div>
        </form>
      )}

      <section className="panel">
        {!data.periods.length ? <div className="empty"><p>No rounds yet. Create the first one to start taking orders.</p></div> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Round</th><th>Status</th><th>Opens</th><th>Closes</th><th className="num">Products</th><th className="num">Orders (paid)</th><th className="num">Paid value</th></tr></thead>
              <tbody>
                {data.periods.map((p) => (
                  <tr key={p.id} className="clickable" onClick={() => nav(`/admin/periods/${p.id}`)}>
                    <td><Link to={`/admin/periods/${p.id}`} onClick={(e) => e.stopPropagation()}><b>{p.name}</b></Link></td>
                    <td><span className={`badge ${p.status === 'open' ? 'badge-ok' : 'badge-blue'}`}>{STAGE_LABEL[p.status]}</span></td>
                    <td>{date(p.opens_at)}</td>
                    <td>{date(p.closes_at)}</td>
                    <td className="num">{p.product_count}</td>
                    <td className="num">{p.order_count} ({p.paid_count})</td>
                    <td className="num">{kes(p.paid_kes)}</td>
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
