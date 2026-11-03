import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, useAction } from '../hooks.js';
import { kes, date, phone as fmtPhone, STAGE_LABEL } from '../format.js';
import { Err, Ok, Loading } from '../components/ui.jsx';
import AuthForm from '../components/AuthForm.jsx';
import Tracker from '../components/Tracker.jsx';

function status(o) {
  if (o.collected_at) return { text: o.fulfilment === 'delivery' ? 'Delivered' : 'Collected', tone: 'ok' };
  if (['cancelled', 'refunded'].includes(o.payment_status)) return { text: 'Cancelled', tone: 'bad' };
  if (o.payment_status === 'refund_pending') return { text: 'Cancelled, refund on the way', tone: 'bad' };
  if (o.payment_status === 'unpaid') return { text: 'Waiting for payment', tone: 'warn' };
  if (o.ready) return { text: o.fulfilment === 'delivery' ? 'Arriving, we will call you' : 'Ready for collection', tone: 'ok' };
  if (o.period_status === 'open') return { text: 'Confirmed', tone: 'blue' };
  return { text: STAGE_LABEL[o.period_status] || 'Confirmed', tone: 'blue' };
}

function OrderCard({ o }) {
  const s = status(o);
  const active = o.payment_status === 'paid' && !o.collected_at;
  return (
    <Link to={`/orders/${o.id}`} className="oc">
      <div className="oc-top">
        <div>
          <b className="oc-no">{o.order_no}</b>
          <span className="muted small"> · placed {date(o.created_at)}</span>
        </div>
        <span className={`oc-status ${s.tone}`}>{s.text}</span>
      </div>
      <p className="oc-items">{o.items_summary || `${o.item_count} item${o.item_count === 1 ? '' : 's'}`}</p>
      {active && <Tracker periodStatus={o.period_status} createdAt={o.created_at} />}
      {o.payment_status === 'unpaid' && o.period_status === 'open' && (
        <div className="oc-pay"><span>Pay before {date(o.closes_at, true)}</span><span className="btn btn-sm">Pay {kes(o.total_kes - o.paid_kes)}</span></div>
      )}
      {active && o.eta_date && o.period_status !== 'ready_for_collection' && <p className="small muted" style={{ margin: '10px 0 0' }}>Expected around {date(o.eta_date)}</p>}
      <div className="oc-foot"><span className="muted small">Total</span><b>{kes(o.total_kes)}</b></div>
    </Link>
  );
}

function Profile() {
  const { user, setUser, logout } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(user.name || '');
  const [email, setEmail] = useState(user.email || '');
  const [optIn, setOptIn] = useState(user.sms_opt_in);
  const [saved, setSaved] = useState(null);
  const { busy, error, run } = useAction();
  const save = (e) => {
    e.preventDefault();
    run(async () => {
      const r = await api('/auth/me', { method: 'PATCH', body: { name, email, sms_opt_in: optIn } });
      setUser(r.user); setSaved('Saved'); setOpen(false);
    });
  };
  return (
    <aside className="panel acct-side">
      <div className="avatar">{(user.name || '?').slice(0, 1).toUpperCase()}</div>
      <h2>{user.name}</h2>
      <p className="muted small" style={{ margin: 0 }}>{fmtPhone(user.phone)}{user.email ? ` · ${user.email}` : ''}</p>
      <Ok msg={saved} />
      {open ? (
        <form onSubmit={save} style={{ marginTop: 16 }}>
          <Err msg={error} />
          <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field"><span>Email</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Get updates by email too" /></label>
          <label className="check field"><input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} /><span>Text me when new preorders open</span></label>
          <div className="row"><button className="btn btn-sm" disabled={busy}>Save</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button></div>
        </form>
      ) : (
        <div className="acct-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => { setOpen(true); setSaved(null); }}>Edit details</button>
          <button className="linkbtn" onClick={() => { logout(); nav('/'); }}>Sign out</button>
        </div>
      )}
    </aside>
  );
}

function Dashboard() {
  const { data, error, loading } = useApi('/orders');
  if (loading && !data) return <Loading />;
  if (error) return <Err msg={error} />;
  const done = (o) => o.collected_at || ['cancelled', 'refunded'].includes(o.payment_status);
  const current = data.orders.filter((o) => !done(o));
  const past = data.orders.filter(done);
  return (
    <div className="acct">
      <Profile />
      <section>
        <h1>Your orders</h1>
        {!data.orders.length ? (
          <div className="panel empty"><h2>No orders yet</h2><p>When you place a preorder you can follow it here, from payment to pickup.</p><Link className="btn" to="/">See what's available</Link></div>
        ) : (
          <>
            {current.length > 0 && <div className="oc-list">{current.map((o) => <OrderCard key={o.id} o={o} />)}</div>}
            {past.length > 0 && (<><h3 className="oc-sub">Past orders</h3><div className="oc-list">{past.map((o) => <OrderCard key={o.id} o={o} />)}</div></>)}
          </>
        )}
      </section>
    </div>
  );
}

export default function Account() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) {
    return (
      <div className="panel auth-card" style={{ margin: '24px auto' }}>
        <h1>Track your orders</h1>
        <p className="muted">Sign in with the number you ordered with to follow your orders.</p>
        <AuthForm submitLabel="Send code" />
      </div>
    );
  }
  return <Dashboard />;
}
