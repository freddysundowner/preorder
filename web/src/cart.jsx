import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { api } from './api.js';
import { useAuth } from './auth.jsx';

const GUEST_KEY = 'preorder_guest_cart';
const CartCtx = createContext(null);
export const useCart = () => useContext(CartCtx);

const readGuest = () => {
  try { return JSON.parse(localStorage.getItem(GUEST_KEY)) || {}; } catch { return {}; }
};
const writeGuest = (m) => {
  try { Object.keys(m).length ? localStorage.setItem(GUEST_KEY, JSON.stringify(m)) : localStorage.removeItem(GUEST_KEY); } catch { /* ignore */ }
};

// One cart for everyone: guests keep it in the browser, signed-in customers on the server.
// The cart has the same shape either way: { period, items, total }.
export function CartProvider({ children }) {
  const { user, loading: authLoading } = useAuth();
  const [cart, setCart] = useState({ period: null, items: [], total: 0 });
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const merged = useRef(null);

  const build = (period, products, map) => {
    const items = products
      .filter((p) => map[p.id] > 0)
      .map((p) => ({ id: p.id, product_id: p.id, qty: Math.min(map[p.id], p.max_qty || map[p.id]), name: p.name, price_kes: p.price_kes, image_url: p.image_url, max_qty: p.max_qty }));
    return { period, items, total: items.reduce((s, i) => s + i.qty * i.price_kes, 0) };
  };

  const refresh = useCallback(async () => {
    if (user) {
      try { setCart(await api('/cart')); } catch { /* keep the old cart */ }
    } else {
      try {
        const { period, products } = await api('/periods/current');
        setCart(build(period, products, readGuest()));
      } catch { /* ignore */ }
    }
    setReady(true);
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    // After login, move anything added as a guest into the account cart
    if (user && merged.current !== user.id) {
      merged.current = user.id;
      const guest = readGuest();
      const ids = Object.keys(guest);
      if (ids.length) {
        writeGuest({});
        Promise.all(ids.map((id) => api('/cart/items', { method: 'POST', body: { productId: Number(id), qty: guest[id] } }).catch(() => {})))
          .finally(refresh);
        return;
      }
    }
    refresh();
  }, [authLoading, user, refresh]);

  const qtyOf = (pid) => cart.items.find((i) => i.product_id === pid)?.qty || 0;

  // Set the quantity of a product (0 removes it). `products` lets guests rebuild the cart.
  const setQty = async (product, qty, products) => {
    if (user) {
      setCart(await api('/cart/items', { method: 'POST', body: { productId: product.id, qty } }));
      return;
    }
    if (product.max_qty && qty > product.max_qty) throw new Error(`You can order at most ${product.max_qty} of this item`);
    const map = { ...readGuest() };
    if (qty > 0) map[product.id] = qty; else delete map[product.id];
    writeGuest(map);
    if (products) setCart(build(cart.period, products, map));
    else refresh();
  };

  const count = cart.items.reduce((s, i) => s + i.qty, 0);
  return <CartCtx.Provider value={{ cart, count, ready, qtyOf, setQty, refresh, open, setOpen }}>{children}</CartCtx.Provider>;
}
