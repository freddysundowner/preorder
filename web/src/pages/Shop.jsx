import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks.js';
import { kes, date, timeLeft } from '../format.js';
import { ProductImage, Qty, Err, Loading } from '../components/ui.jsx';
import { useCart } from '../cart.jsx';
import { useAuth } from '../auth.jsx';

export function Countdown({ to, label = 'Orders close in', bare = false }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t); }, []);
  const t = timeLeft(to);
  if (!t) return <b>Closed</b>;
  const text = t.d > 0 ? `${t.d}d ${t.h}h` : `${t.h}h ${t.m}m`;
  return bare ? <>{text}</> : <span>{label} <b>{text}</b></span>;
}

export function RoundStrip({ period }) {
  return (
    <div className="roundstrip">
      <span className="dot" /> <b>Preorders open</b>
      <span className="sep">·</span><Countdown to={period.closes_at} />
      {period.eta_date && <><span className="sep">·</span><span>Arrives ~{date(period.eta_date)}</span></>}
    </div>
  );
}

function ComingSoonTeaser() {
  const { data } = useApi('/proposed-items');
  const items = data?.items || [];
  if (!items.length) return null;
  const top = [...items].sort((a, b) => b.interest_count - a.interest_count).slice(0, 3);
  const votes = items.reduce((s, i) => s + i.interest_count, 0);
  return (
    <section className="teaser">
      <div className="teaser-copy">
        <span className="sf-eyebrow">Sneak peek</span>
        <h2>{items.length} new item{items.length === 1 ? ' is' : 's are'} on the way</h2>
        <p>{votes > 0 ? `${votes} vote${votes === 1 ? '' : 's'} so far. ` : ''}Tell us what you'd order and it could land in the next round. You might spot something you can't find anywhere else.</p>
        <Link to="/coming-soon" className="btn">See what's coming</Link>
      </div>
      <Link to="/coming-soon" className="teaser-art" aria-label="See what's coming">
        {top.map((it, i) => (
          <div key={it.id} className={`teaser-tile t${i}`}>
            <ProductImage src={it.image_url} name={it.name} />
            <span className="teaser-lock">?</span>
          </div>
        ))}
      </Link>
    </section>
  );
}

export default function Shop() {
  const { data, error, loading } = useApi('/periods/current');
  const { info } = useAuth();
  const { cart, count, qtyOf, setQty: cartSetQty, setOpen } = useCart();
  const [params] = useSearchParams();
  const q = (params.get('q') || '').toLowerCase();
  const [err, setErr] = useState(null);
  const [sort, setSort] = useState('featured');

  const setQty = async (product, qty) => {
    setErr(null);
    try { await cartSetQty(product, qty, data.products); } catch (e) { setErr(e.message); }
  };

  if (loading) return <Loading />;
  if (error) return <Err msg={error} />;

  if (!data.period) {
    return (
      <div className="panel empty">
        <h2>Ordering is closed right now</h2>
        {data.next
          ? <p>Preorders open again on {date(data.next.opens_at, true)}.</p>
          : <p>The next round of products will be announced soon.</p>}
        <Link className="btn" to="/coming-soon">See what's coming</Link>
      </div>
    );
  }

  const sorters = { featured: null, low: (x, y) => x.price_kes - y.price_kes, high: (x, y) => y.price_kes - x.price_kes, name: (x, y) => x.name.localeCompare(y.name) };
  const products = data.products
    .filter((p) => !q || `${p.name} ${p.description || ''}`.toLowerCase().includes(q))
    .sort(sorters[sort] || (() => 0));
  const featured = data.products.slice(0, 3);

  return (
    <>
      {!q && (
        <section className="sf-hero">
          <div className="sf-hero-copy">
            <span className="sf-eyebrow">Preorders are open</span>
            <h1>{info.storeHeadline}</h1>
            <p>{info.storeTagline}</p>
            <div className="sf-hero-cta">
              <a href="#products" className="btn btn-dark">See what's available</a>
              <Link to="/how-it-works" className="btn btn-ghost">How it works</Link>
            </div>
          </div>
          <div className="sf-hero-art" aria-hidden="true">
            {featured.map((p, i) => (
              <Link key={p.id} to={`/product/${p.id}`} className={`sf-collage c${i}`} tabIndex={-1}>
                <ProductImage src={p.image_url} name={p.name} />
              </Link>
            ))}
          </div>
        </section>
      )}

      {!q && (
        <section className="sf-trust">
          <div><b>Pay with M-Pesa</b><span>Secure prompt on your phone</span></div>
          <div><b>Updates by SMS</b><span>From dispatch to pickup</span></div>
          <div><b>Collect in person</b><span>{info.shopLocation}</span></div>
        </section>
      )}

      <Err msg={err} />
      <div className="sf-head" id="products">
        <div>
          <h2>{q ? `Results for “${params.get('q')}”` : info.collectionTitle || 'Available for preorder'}</h2>
          <span className="muted small">{products.length} item{products.length === 1 ? '' : 's'}</span>
        </div>
        <label className="sf-sort">
          <span>Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="featured">Featured</option>
            <option value="low">Price, low to high</option>
            <option value="high">Price, high to low</option>
            <option value="name">Name, A–Z</option>
          </select>
        </label>
      </div>

      {products.length === 0 ? (
        <div className="panel empty"><p>{q ? 'No products match your search.' : 'Products are being added. Check back soon.'}</p>{q && <Link to="/" className="btn">Clear search</Link>}</div>
      ) : (
        <div className="sf-grid">
          {products.map((p) => {
            const n = qtyOf(p.id);
            return (
              <article className="sf-card" key={p.id}>
                <div className="sf-card-media">
                  <Link to={`/product/${p.id}`} aria-label={p.name}><ProductImage src={p.image_url} name={p.name} /></Link>
                  <div className="sf-quick">
                    {n === 0
                      ? <button className="btn btn-dark btn-block" onClick={() => setQty(p, 1)}>Preorder</button>
                      : <div className="sf-quick-qty"><Qty value={n} max={p.max_qty} onChange={(v) => setQty(p, v)} /><span>in cart</span></div>}
                  </div>
                </div>
                <h3><Link to={`/product/${p.id}`}>{p.name}</Link></h3>
                <div className="sf-price">{kes(p.price_kes)}</div>
              </article>
            );
          })}
        </div>
      )}

      {!q && <ComingSoonTeaser />}

      {count > 0 && (
        <div className="cartbar">
          <span><b>{count}</b> item{count > 1 ? 's' : ''} · <b className="num">{kes(cart.total)}</b></span>
          <button className="btn btn-pay" onClick={() => setOpen(true)}>View cart</button>
        </div>
      )}
    </>
  );
}
