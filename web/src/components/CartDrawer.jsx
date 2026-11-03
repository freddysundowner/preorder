import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCart } from '../cart.jsx';
import { kes } from '../format.js';
import { ProductImage, Qty } from './ui.jsx';

export default function CartDrawer() {
  const { cart, open, setOpen, setQty } = useCart();
  const nav = useNavigate();
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);
  if (!open) return null;

  const go = () => { setOpen(false); nav('/checkout'); };
  return (
    <div className="drawer-wrap">
      <div className="drawer-scrim" onClick={() => setOpen(false)} />
      <aside className="drawer" role="dialog" aria-label="Your cart">
        <div className="drawer-head">
          <h2>Your cart</h2>
          <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">×</button>
        </div>
        {cart.items.length === 0 ? (
          <div className="drawer-empty"><p>Your cart is empty.</p><button className="btn" onClick={() => { setOpen(false); nav('/'); }}>Browse products</button></div>
        ) : (
          <>
            <div className="drawer-body">
              {cart.items.map((it) => (
                <div className="drawer-line" key={it.id}>
                  <ProductImage src={it.image_url} name={it.name} className="thumb" />
                  <div className="grow">
                    <b>{it.name}</b>
                    <div className="price-sm">{kes(it.price_kes)}</div>
                    <Qty value={it.qty} max={it.max_qty} onChange={(v) => setQty({ id: it.product_id, max_qty: it.max_qty }, v, null)} />
                  </div>
                </div>
              ))}
            </div>
            <div className="drawer-foot">
              <div className="spread"><span>Subtotal</span><b className="price">{kes(cart.total)}</b></div>
              <button className="btn btn-pay btn-block" onClick={go}>Checkout</button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
