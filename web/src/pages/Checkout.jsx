import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAction } from '../hooks.js';
import { useCart } from '../cart.jsx';
import { useAuth } from '../auth.jsx';
import { kes, date, phone as fmtPhone } from '../format.js';
import { ProductImage, Qty, Err, Loading } from '../components/ui.jsx';
import AuthForm from '../components/AuthForm.jsx';

export default function Checkout() {
  const { cart, ready, setQty, refresh } = useCart();
  const { user, info } = useAuth();
  const nav = useNavigate();
  const { busy, error, run } = useAction();
  const [mpesa, setMpesa] = useState('');
  const [orderId, setOrderId] = useState(null);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(null);
  const [slow, setSlow] = useState(false);
  const [amount, setAmount] = useState(0);
  const [fulfilment, setFulfilment] = useState('pickup');
  const [address, setAddress] = useState('');
  const [contact, setContact] = useState('');
  const fee = fulfilment === 'delivery' ? info.deliveryFeeKes || 0 : 0;

  useEffect(() => { if (user && !mpesa) { setMpesa(fmtPhone(user.phone)); setContact(fmtPhone(user.phone)); } }, [user]); // eslint-disable-line

  // After the M-Pesa prompt is sent, watch the order until it is paid
  useEffect(() => {
    if (!waiting || !orderId) return;
    const poll = async () => {
      try {
        await api(`/orders/${orderId}/refresh-payment`, { method: 'POST' }).catch(() => {});
        const { order } = await api(`/orders/${orderId}`);
        if (order.payment_status === 'paid') return nav(`/orders/${orderId}?paid=1`, { replace: true });
        if (order.payments[0]?.status === 'failed') {
          setFailed(order.payments[0].result_desc || 'The payment was cancelled');
          setWaiting(false);
        }
      } catch { /* keep polling */ }
    };
    const t = setInterval(poll, 3000);
    const slowT = setTimeout(() => setSlow(true), 60000);
    return () => { clearInterval(t); clearTimeout(slowT); };
  }, [waiting, orderId, nav]);

  const placeAndPay = () => run(async () => {
    setFailed(null); setSlow(false);
    let id = orderId;
    setAmount(cart.total + fee);
    if (!id) {
      const { order } = await api('/orders/checkout', {
        method: 'POST',
        body: { fulfilment, delivery_address: address, delivery_phone: contact },
      });
      id = order.id;
      setOrderId(id);
      await refresh();
    }
    await api(`/orders/${id}/pay`, { method: 'POST', body: { phone: mpesa } });
    setWaiting(true);
  });

  if (!ready) return <Loading />;

  if (orderId) {
    return (
      <div className="pay-wait panel">
        {waiting ? (
          <>
            <div className="spinner" aria-hidden="true" />
            <h2>Check your phone</h2>
            <p className="muted">Enter your M-Pesa PIN to pay <b>{kes(amount)}</b> and complete your order. This page updates on its own.</p>
            {slow && <p className="small">Taking long? Your order is saved. <Link to={`/orders/${orderId}`}>View it here</Link>.</p>}
          </>
        ) : (
          <>
            <h2>Order placed, payment needed</h2>
            {failed && <div className="alert alert-warn">That payment didn't go through: {failed}</div>}
            <Err msg={error} />
            <label className="field" style={{ textAlign: 'left' }}>
              <span>M-Pesa number</span>
              <input type="tel" value={mpesa} onChange={(e) => setMpesa(e.target.value)} />
            </label>
            <button className="btn btn-pay btn-block" onClick={placeAndPay} disabled={busy}>{busy ? 'Sending…' : 'Try again'}</button>
            <p className="small"><Link to={`/orders/${orderId}`}>Pay later from My orders</Link></p>
          </>
        )}
      </div>
    );
  }

  const { items, total, period } = cart;
  if (!period) return <div className="panel empty"><h2>Ordering is closed</h2><p>New orders open with the next round.</p><Link className="btn" to="/coming-soon">See what's coming</Link></div>;
  if (!items.length) return <div className="panel empty"><h2>Your cart is empty</h2><Link className="btn" to="/">Browse products</Link></div>;

  return (
    <>
      <h1>Checkout</h1>
      <div className="checkout">
        <div className="checkout-main">
          <section className="panel step">
            <h2><span className="step-n">1</span> Your details</h2>
            {user
              ? <p style={{ margin: 0 }}>{user.name} · {fmtPhone(user.phone)}</p>
              : <AuthForm submitLabel="Continue" />}
          </section>

          <section className={`panel step ${user ? '' : 'step-off'}`}>
            <h2><span className="step-n">2</span> How do you want to receive it?</h2>
            {user && (
              <>
                <div className="choice">
                  <label className={`choice-opt ${fulfilment === 'pickup' ? 'on' : ''}`}>
                    <input type="radio" name="fulfilment" checked={fulfilment === 'pickup'} onChange={() => setFulfilment('pickup')} />
                    <span><b>Pick up</b><small>Collect at {info.shopLocation} with the code we text you. Free.</small></span>
                  </label>
                  <label className={`choice-opt ${fulfilment === 'delivery' ? 'on' : ''}`}>
                    <input type="radio" name="fulfilment" checked={fulfilment === 'delivery'} onChange={() => setFulfilment('delivery')} />
                    <span><b>Delivery</b><small>We bring it to you. {info.deliveryFeeKes ? `Delivery fee ${kes(info.deliveryFeeKes)}.` : 'Free delivery.'}</small></span>
                  </label>
                </div>
                {fulfilment === 'delivery' && (
                  <>
                    <label className="field">
                      <span>Delivery address</span>
                      <textarea rows="2" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Estate, street, landmark, town" required />
                    </label>
                    <label className="field">
                      <span>Phone for the delivery</span>
                      <input type="tel" value={contact} onChange={(e) => setContact(e.target.value)} />
                      <small>We call this number to arrange the delivery.</small>
                    </label>
                  </>
                )}
              </>
            )}
          </section>

          <section className={`panel step ${user ? '' : 'step-off'}`}>
            <h2><span className="step-n">3</span> Pay with M-Pesa</h2>
            {user && (
              <>
                <Err msg={error} />
                <label className="field">
                  <span>M-Pesa number</span>
                  <input type="tel" value={mpesa} onChange={(e) => setMpesa(e.target.value)} />
                  <small>You'll get a prompt on this phone to enter your PIN.</small>
                </label>
                <button className="btn btn-pay btn-block" onClick={placeAndPay} disabled={busy}>{busy ? 'Sending…' : `Pay ${kes(total + fee)}`}</button>
              </>
            )}
          </section>

          <p className="small muted" style={{ margin: '4px 4px 0' }}>
            We order the whole batch after {date(period.closes_at, true)}. You get an SMS when it is on the way and when it is ready{fulfilment === 'delivery' ? ' for delivery' : ', with your pickup code'}.
          </p>
        </div>

        <aside className="panel summary">
          <h2>Order summary</h2>
          {items.map((it) => (
            <div className="drawer-line" key={it.id}>
              <ProductImage src={it.image_url} name={it.name} className="thumb" />
              <div className="grow">
                <b>{it.name}</b>
                <div className="price-sm">{kes(it.price_kes)}</div>
                <Qty value={it.qty} max={it.max_qty} onChange={(v) => setQty({ id: it.product_id, max_qty: it.max_qty }, v, null)} />
              </div>
            </div>
          ))}
          {fee > 0 && <div className="line"><span>Delivery</span><span className="num">{kes(fee)}</span></div>}
          <div className="totals"><b>Total</b><span className="price num">{kes(total + fee)}</span></div>
          <p className="small muted" style={{ marginTop: 10 }}>Unpaid orders are cancelled when the round closes.</p>
        </aside>
      </div>
    </>
  );
}
