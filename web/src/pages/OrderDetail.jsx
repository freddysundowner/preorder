import { ask } from '../components/Dialogs.jsx';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApi, useAction } from '../hooks.js';
import { useAuth } from '../auth.jsx';
import { kes, date, phone as fmtPhone, STAGE_LABEL } from '../format.js';
import { PayBadge, Err, Ok, Loading } from '../components/ui.jsx';
import Tracker from '../components/Tracker.jsx';

export default function OrderDetail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { user, info } = useAuth();
  const { data, error, loading, reload } = useApi(`/orders/${id}`);
  const { busy, error: actErr, run } = useAction();
  const [payPhone, setPayPhone] = useState(fmtPhone(user?.phone));
  const [waiting, setWaiting] = useState(false);
  const [msg, setMsg] = useState(null);

  // While waiting for the M-Pesa prompt to be approved, poll the order
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(async () => { await api(`/orders/${id}/refresh-payment`, { method: 'POST' }).catch(() => {}); reload(); }, 3000);
    const stop = setTimeout(() => setWaiting(false), 120000);
    return () => { clearInterval(t); clearTimeout(stop); };
  }, [waiting, reload, id]);

  useEffect(() => {
    if (!data) return;
    const o = data.order;
    if (waiting && o.payment_status === 'paid') { setWaiting(false); setMsg('Payment received. Your order is confirmed.'); }
    const latest = o.payments[0];
    if (waiting && latest?.status === 'failed') { setWaiting(false); }
  }, [data, waiting]);

  if (loading && !data) return <Loading />;
  if (error) return <Err msg={error} />;
  const o = data.order;
  const balance = o.total_kes - o.paid_kes;
  const canPay = o.payment_status === 'unpaid' && o.period_status === 'open';
  const isActive = o.payment_status === 'paid';
  const lastFailed = o.payments[0]?.status === 'failed' ? o.payments[0] : null;

  const pay = () => run(async () => {
    await api(`/orders/${o.id}/pay`, { method: 'POST', body: { phone: payPhone } });
    setMsg(null);
    setWaiting(true);
    reload();
  });

  const cancel = async () => {
    if (!(await ask(`Cancel order ${o.order_no}?`, { confirmLabel: 'Cancel order', danger: true }))) return;
    run(async () => { await api(`/orders/${o.id}/cancel`, { method: 'POST' }); reload(); });
  };

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <Link to="/account" className="small">‹ My orders</Link>
          <h1 style={{ marginTop: 4 }}>Order {o.order_no}</h1>
          <p className="muted" style={{ margin: 0 }}>Placed {date(o.created_at)}</p>
        </div>
        <PayBadge order={o} />
      </div>

      <Ok msg={msg || (params.get('paid') ? 'Payment received. Your order is confirmed, we will text you at every shipping stage.' : params.get('new') && o.payment_status === 'unpaid' && !waiting ? 'Order placed. Pay below to confirm it.' : null)} />
      <Err msg={actErr} />

      {canPay && (
        <section className="panel">
          <h2>Pay {kes(balance)}</h2>
          {waiting ? (
            <div className="alert alert-info" role="status">
              Check your phone for the M-Pesa prompt and enter your PIN. This page updates when payment arrives.
            </div>
          ) : (
            <>
              {lastFailed && <div className="alert alert-warn">The last payment didn't go through: {lastFailed.result_desc || 'cancelled'}. Try again.</div>}
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <label className="field" style={{ flex: 1, minWidth: 200, marginBottom: 0 }}>
                  <span>M-Pesa number</span>
                  <input type="tel" value={payPhone} onChange={(e) => setPayPhone(e.target.value)} />
                </label>
                <button className="btn btn-pay" onClick={pay} disabled={busy}>{busy ? 'Sending…' : 'Pay with M-Pesa'}</button>
              </div>
            </>
          )}
          <p className="small muted" style={{ marginTop: 14, marginBottom: 0 }}>
            {info.paymentProvider !== 'sunpay' && <>Or pay from the M-Pesa menu: Paybill <b>{info.paybillNumber}</b>, account <b>{o.order_no}</b>. </>}
            Pay before {date(o.closes_at, true)}.
            {o.paid_kes > 0 && <> Already paid: {kes(o.paid_kes)}.</>}
          </p>
        </section>
      )}

      {isActive && (
        <section className="panel">
          <div className="panel-head">
            <h2>Shipment</h2>
            <span className="badge badge-blue">{STAGE_LABEL[o.period_status]}</span>
          </div>
          <Tracker periodStatus={o.period_status} events={o.events} createdAt={o.paid_at || o.created_at} />
          {o.eta_date && !o.collected_at && o.period_status !== 'ready_for_collection' && (
            <div className="eta"><span className="muted">Expected arrival</span><strong>{date(o.eta_date)}</strong></div>
          )}
          {o.fulfilment === 'delivery' && !o.collected_at && (
            <div className="pickup" style={{ marginTop: 18 }}>
              <b>{o.ready ? 'Your order has arrived and is being arranged for delivery.' : 'Delivery to you.'}</b> We will call {fmtPhone(o.delivery_phone || o.customer_phone)}.
              <div className="small muted">{o.delivery_address}</div>
            </div>
          )}
          {o.fulfilment !== 'delivery' && o.ready && !o.collected_at && (
            <div className="pickup" style={{ marginTop: 18 }}>
              <b>Ready for collection at {info.shopLocation}.</b> Bring the pickup code we sent you by SMS.
            </div>
          )}
          {o.delivered_at && (
            <div className="alert alert-ok" style={{ marginTop: 18, marginBottom: 0 }}>
              Delivered on {date(o.delivered_at, true)} to {o.delivery_address}.
            </div>
          )}
          {o.collected_at && !o.delivered_at && (
            <div className="alert alert-ok" style={{ marginTop: 18, marginBottom: 0 }}>
              Collected on {date(o.collected_at, true)} by {o.collected_by_name}{o.collected_by_phone ? `, ${fmtPhone(o.collected_by_phone)}` : ''}.
            </div>
          )}
        </section>
      )}

      {o.payment_status === 'cancelled' && <div className="alert alert-warn">This order was cancelled.</div>}
      {o.refund_due_kes > 0 && <div className="alert alert-warn">A refund of {kes(o.refund_due_kes)} is being processed to your M-Pesa.</div>}
      {o.payment_status === 'refunded' && <div className="alert alert-info">This order was cancelled and refunded.</div>}

      <section className="panel">
        <h2>Items</h2>
        {o.items.map((it) => (
          <div className="line" key={it.id} style={it.status === 'cancelled' ? { opacity: .55 } : undefined}>
            <div className="line-name">
              <b>{it.product_name}</b>
              {it.status === 'cancelled' && <> <span className="badge badge-bad">Not shipped</span></>}
              <div className="small muted num">{it.qty} × {kes(it.unit_price_kes)}</div>
            </div>
            <span className="num">{kes(it.qty * it.unit_price_kes)}</span>
          </div>
        ))}
        {o.delivery_fee_kes > 0 && <div className="line"><span>Delivery</span><span className="num">{kes(o.delivery_fee_kes)}</span></div>}
        <div className="totals"><b>Total</b><span className="price num">{kes(o.total_kes)}</span></div>
      </section>

      {o.payments.some((p) => p.status === 'approved') && (
        <section className="panel">
          <h3>Payments</h3>
          {o.payments.filter((p) => p.status === 'approved').map((p) => (
            <div className="line" key={p.id}>
              <div className="line-name">{p.mpesa_receipt || 'Payment'}<div className="small muted">{date(p.created_at, true)}</div></div>
              <span className="num">{kes(p.amount_kes)}</span>
            </div>
          ))}
        </section>
      )}

      {['unpaid', 'paid'].includes(o.payment_status) && o.period_status === 'open' && (
        <p className="small"><button className="linkbtn" onClick={cancel} disabled={busy}>Cancel this order</button></p>
      )}
    </div>
  );
}
