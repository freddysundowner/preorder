import { useState } from 'react';
import { useApi } from '../../hooks.js';
import { date, phone } from '../../format.js';
import { Err, Loading } from '../../components/ui.jsx';

const TEMPLATE = {
  invoice: 'Invoice', payment_received: 'Payment', closing_reminder: 'Reminder', unpaid_cancelled: 'Cancelled at close',
  product_cancelled: 'Item cancelled', ready_for_collection: 'Ready + pickup code', collected: 'Collected',
  period_opened: 'New round', order_cancelled: 'Order cancelled',
  status_supplier_dispatching: 'Dispatched', status_warehouse_received: 'At warehouse', status_in_transit: 'On the way',
};

export default function SmsLog() {
  const [tab, setTab] = useState('sms');
  return (
    <div className="stack">
      <h1>Messages</h1>
      <div className="tabs" role="tablist">
        <button className={tab === 'sms' ? 'on' : ''} onClick={() => setTab('sms')}>SMS</button>
        <button className={tab === 'email' ? 'on' : ''} onClick={() => setTab('email')}>Email</button>
      </div>
      {tab === 'sms' ? <SmsTab /> : <EmailTab />}
    </div>
  );
}

function EmailTab() {
  const { data, error, loading } = useApi('/admin/emails');
  if (loading) return <Loading />;
  if (error) return <Err msg={error} />;
  return (
    <>
      <div className="stats">
        <div className="stat"><div className="v">{data.stats.last_30_days}</div><div className="k">Sent in last 30 days</div></div>
        <div className="stat"><div className="v">{data.stats.total}</div><div className="k">Sent in total</div></div>
        <div className={`stat ${data.stats.failed ? 'alert-stat' : ''}`}><div className="v">{data.stats.failed}</div><div className="k">Failed</div></div>
      </div>
      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>To</th><th>Subject</th><th>Status</th></tr></thead>
            <tbody>
              {data.messages.length === 0 && <tr><td colSpan="4" className="muted">No emails yet. Turn on email in Settings.</td></tr>}
              {data.messages.map((m) => (
                <tr key={m.id}>
                  <td className="small" style={{ whiteSpace: 'nowrap' }}>{date(m.sent_at, true)}</td>
                  <td className="small">{m.user_name || '—'}<div className="muted">{m.to_email}</div></td>
                  <td className="small">{m.subject}</td>
                  <td><span className={`badge ${m.status === 'failed' ? 'badge-bad' : 'badge-ok'}`}>{m.status}</span>{m.error && <div className="small muted">{m.error}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function SmsTab() {
  const { data, error, loading } = useApi('/admin/sms');
  if (loading) return <Loading />;
  if (error) return <Err msg={error} />;
  return (
    <>
      <div className="stats">
        <div className="stat"><div className="v">{data.stats.last_30_days}</div><div className="k">Sent in last 30 days</div></div>
        <div className="stat"><div className="v">{data.stats.total}</div><div className="k">Sent in total</div></div>
        <div className={`stat ${data.stats.failed ? 'alert-stat' : ''}`}><div className="v">{data.stats.failed}</div><div className="k">Failed</div></div>
      </div>
      <section className="panel">
        <p className="small muted">Login codes are not shown. Latest 300 messages.</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>To</th><th>Type</th><th>Message</th><th>Status</th></tr></thead>
            <tbody>
              {data.messages.map((m) => (
                <tr key={m.id}>
                  <td className="small" style={{ whiteSpace: 'nowrap' }}>{date(m.sent_at, true)}</td>
                  <td className="small">{m.user_name || '—'}<div className="muted">{phone(m.phone)}</div></td>
                  <td className="small">{TEMPLATE[m.template] || m.template}</td>
                  <td className="small" style={{ maxWidth: 420 }}>{m.body}</td>
                  <td><span className={`badge ${/fail|reject/i.test(m.status) ? 'badge-bad' : /success|sent|logged/i.test(m.status) ? 'badge-ok' : ''}`}>{m.status}</span>{m.error && <div className="small muted">{m.error}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
