import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApi } from '../hooks.js';
import { kes, date } from '../format.js';
import { ProductImage, Qty, Err, Loading } from '../components/ui.jsx';
import { useCart } from '../cart.jsx';
import { useAuth } from '../auth.jsx';
import { RoundStrip } from './Shop.jsx';

export default function Product() {
  const { id } = useParams();
  const { data, error, loading } = useApi('/periods/current');
  const { qtyOf, setQty, setOpen } = useCart();
  const { info } = useAuth();
  const nav = useNavigate();
  const [qty, setLocalQty] = useState(1);
  const [err, setErr] = useState(null);

  if (loading) return <Loading />;
  if (error) return <Err msg={error} />;
  const p = data.products.find((x) => String(x.id) === id);
  if (!p) return <div className="panel empty"><h2>This product isn't available</h2><Link className="btn" to="/">Back to shop</Link></div>;

  const inCart = qtyOf(p.id);
  const add = async (checkout) => {
    setErr(null);
    try {
      await setQty(p, Math.min(inCart + qty, p.max_qty || 999), data.products);
      if (checkout) nav('/checkout'); else setOpen(true);
    } catch (e) { setErr(e.message); }
  };

  return (
    <>
      <p className="small"><Link to="/">‹ All products</Link></p>
      <div className="pdp">
        <ProductImage src={p.image_url} name={p.name} className="pdp-img" />
        <div className="pdp-info">
          <h1>{p.name}</h1>
          <div className="price pdp-price">{kes(p.price_kes)}</div>
          {p.description && <p>{p.description}</p>}
          <ul className="facts">
            <li>Order and pay by <b>{date(data.period.closes_at, true)}</b></li>
            {data.period.eta_date && <li>Expected around <b>{date(data.period.eta_date)}</b></li>}
            <li>Pay with M-Pesa · collect at {info.shopLocation || 'our shop'}</li>
            {p.max_qty && <li>Limit {p.max_qty} per customer</li>}
          </ul>
        </div>
        <aside className="buybox">
          <div className="price">{kes(p.price_kes)}</div>
          <RoundStrip period={data.period} />
          <Err msg={err} />
          <div className="spread"><span>Quantity</span><Qty value={qty} max={p.max_qty} onChange={(v) => setLocalQty(Math.max(1, v))} /></div>
          <button className="btn btn-block" onClick={() => add(false)}>Add to cart</button>
          <button className="btn btn-pay btn-block" onClick={() => add(true)}>Preorder now</button>
          {inCart > 0 && <p className="small muted" style={{ margin: 0 }}>{inCart} already in your cart</p>}
        </aside>
      </div>
    </>
  );
}
