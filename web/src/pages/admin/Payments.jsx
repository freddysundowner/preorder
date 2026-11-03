import { ask } from '../../components/Dialogs.jsx';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useApi, useAction } from '../../hooks.js';
import { kes, date, phone } from '../../format.js';
import { Err, Ok, Loading } from '../../components/ui.jsx';

const TABS = [
  { key: '', label: 'All' },
  { key: 'unmatched', label: 'Unmatched' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'failed', label: 'Failed' },
];
const STATUS_BADGE = { approved: 'badge-ok', pending: 'badge-warn', unmatched: 'badge-refund_pending', failed: 'badge-bad', rejected: 'badge-bad' };
const METHOD = { stk: 'M-Pesa prompt', paybill: 'Paybill', manual: 'Recorded by admin' };

export default function Payments() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || '';
  const { data, error, loading, reload } = useApi(`/admin/payments${tab ? `?status=${tab}` : ''}`);
  const { busy, error: err, run } = useAction();
  const [msg, setMsg] = useState(null);
  const [manual, setManual] = useState(null);
  const [matching, setMatching] = useState({});

  const act = (fn, ok) => { setMsg(null); return run(async () => { await fn(); setMsg(ok); reload(); }); };

  const recordManual = (e) => {
    e.preventDefault();
    act(async () => {
      await api('/admin/payments/manual', { method: 'POST', body: manual });
      setManual(null);
    }, 'Payment recorded and the customer notified');
  };

  return (
    <div className="stack">
      <div className="spread">
        <h1 style={{ margin: 0 }}>Payments</h1>
        {!manual && <button className="btn" onClick={() => setManual({ order_no: '', amount_kes: '', mpesa_receipt: '', note: '' })}>Record a payment</button>}
      </div>
      <Ok msg={msg} />
      <Err msg={err} />

      {manual && (
        <form className="panel" onSubmit={recordManual}>
          <h2>Record a payment</h2>
          <p className="small muted">For money received outside the M-Pesa prompt, such as cash or a Paybill payment that didn't come through automatically.</p>
          <div className="form-row">
            <label className="field"><span>Order number</span><input value={manual.order_no} onChange={(e) => setManual({ ...manual, order_no: e.target.value })} placeholder="PO1001" required /></label>
            <label className="field"><span>Amount (KES)</span><input type="number" min="1" value={manual.amount_kes} onChange={(e) => setManual({ ...manual, amount_kes: e.target.value })} required /></label>
            <label className="field"><span>M-Pesa code (if any)</span><input value={manual.mpesa_receipt} onChange={(e) => setManual({ ...manual, mpesa_receipt: e.target.value })} /></label>
          </div>
          <label className="field"><span>Note</span><input value={manual.note} onChange={(e) => setManual({ ...manual, note: e.target.value })} /></label>
          <div className="row"><button className="btn" disabled={busy}>Record payment</button><button type="button" className="btn btn-ghost" onClick={() => setManual(null)}>Cancel</button></div>
        </form>
      )}

      <section className="panel">
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'on' : ''}
              onClick={() => setParams(t.key ? { tab: t.key } : {})}>{t.label}</button>
          ))}
        </div>
        {tab === 'unmatched' && <p className="small muted">Paybill payments where the account number didn't match an order. Enter the right order number to apply them.</p>}
        {loading && !data ? <Loading /> : error ? <Err msg={error} /> : !data.payments.length ? <div className="empty"><p>No payments here.</p></div> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>When</th><th>Order</th><th>From</th><th>Method</th><th>M-Pesa code</th><th className="num">Amount</th><th>Status</th><th /></tr></thead>
              <tbody>
                {data.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="small">{date(p.created_at, true)}</td>
                    <td>{p.order_no ? <b>{p.order_no}</b> : <span className="muted">—</span>}<div className="small muted">{p.customer_name}</div></td>
                    <td className="small">{phone(p.phone)}</td>
                    <td className="small">{METHOD[p.method]}</td>
                    <td className="small">{p.mpesa_receipt || '—'}</td>
                    <td className="num">{kes(p.amount_kes)}</td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[p.status] || ''}`}>{p.status}</span>
                      {p.result_desc && p.status !== 'approved' && <div className="small muted">{p.result_desc}</div>}
                    </td>
                    <td>
                      {p.status === 'unmatched' && (
                        <form className="row" style={{ gap: 6, flexWrap: 'nowrap' }} onSubmit={(e) => {
                          e.preventDefault();
                          act(() => api(`/admin/payments/${p.id}/match`, { method: 'POST', body: { order_no: matching[p.id] } }), 'Payment matched to order');
                        }}>
                          <input style={{ width: 110, padding: '6px 8px' }} placeholder="Order no." value={matching[p.id] || ''} onChange={(e) => setMatching({ ...matching, [p.id]: e.target.value })} required />
                          <button className="btn btn-sm" disabled={busy}>Apply</button>
                        </form>
                      )}
                      {['pending', 'unmatched'].includes(p.status) && (
                        <button className="linkbtn small" style={{ marginTop: 4 }} disabled={busy} onClick={async () => {
                          if (await ask('Mark this payment as rejected?', { confirmLabel: 'Reject payment', danger: true })) act(() => api(`/admin/payments/${p.id}/reject`, { method: 'POST', body: {} }), 'Payment rejected');
                        }}>Reject</button>
                      )}
                    </td>
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
