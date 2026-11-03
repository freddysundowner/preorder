import { ask } from '../../components/Dialogs.jsx';
import { useState } from 'react';
import { api } from '../../api.js';
import { useApi, useAction } from '../../hooks.js';
import { kes } from '../../format.js';
import ImageField from '../../components/ImageField.jsx';
import { Err, Loading, ProductImage } from '../../components/ui.jsx';

export default function Proposed() {
  const { data, error, loading, reload } = useApi('/admin/proposed-items');
  const [form, setForm] = useState(null);
  const { busy, error: err, run } = useAction();
  const max = Math.max(1, ...(data?.items || []).map((i) => i.interested));

  const save = (e) => {
    e.preventDefault();
    run(async () => { await api('/admin/proposed-items', { method: 'POST', body: form }); setForm(null); reload(); });
  };
  const toggle = (it) => run(async () => { await api(`/admin/proposed-items/${it.id}`, { method: 'PATCH', body: { active: !it.active } }); reload(); });
  const remove = async (it) => (await ask(`Delete ${it.name} and its votes?`, { confirmLabel: 'Delete', danger: true })) && run(async () => { await api(`/admin/proposed-items/${it.id}`, { method: 'DELETE' }); reload(); });

  return (
    <div className="stack">
      <div className="spread">
        <h1 style={{ margin: 0 }}>Coming soon items</h1>
        {!form && <button className="btn" onClick={() => setForm({ name: '', description: '', image_url: '', est_price_kes: '' })}>Add item</button>}
      </div>
      <p className="muted" style={{ marginTop: 4 }}>Items customers can say they want. Use the counts to decide what to bring in next round.</p>
      <Err msg={err} />
      {form && (
        <form className="panel" onSubmit={save}>
          <div className="form-row">
            <label className="field"><span>Name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
            <label className="field"><span>Rough price (KES)</span><input type="number" value={form.est_price_kes} onChange={(e) => setForm({ ...form, est_price_kes: e.target.value })} /></label>
          </div>
          <label className="field"><span>Description</span><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <ImageField value={form.image_url} name={form.name} onChange={(v) => setForm({ ...form, image_url: v })} />
          <div className="row"><button className="btn" disabled={busy}>Add item</button><button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button></div>
        </form>
      )}
      <section className="panel">
        {loading && !data ? <Loading /> : error ? <Err msg={error} /> : !data.items.length ? <div className="empty"><p>No items yet.</p></div> : (
          data.items.map((it) => (
            <div className="line" key={it.id} style={!it.active ? { opacity: .55 } : undefined}>
              <ProductImage src={it.image_url} name={it.name} className="thumb" />
              <div className="line-name">
                <b>{it.name}</b> {!it.active && <span className="badge">Hidden</span>}
                <div className="small muted">{it.est_price_kes ? kes(it.est_price_kes) : 'No price'} · {it.interested} {it.interested === 1 ? 'person' : 'people'}, {it.total_qty} units wanted</div>
                <div className="bar" style={{ marginTop: 6, maxWidth: 260 }}><i style={{ width: `${(it.interested / max) * 100}%` }} /></div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => toggle(it)} disabled={busy}>{it.active ? 'Hide' : 'Show'}</button>
                <button className="btn btn-danger btn-sm" onClick={() => remove(it)} disabled={busy}>Delete</button>
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
