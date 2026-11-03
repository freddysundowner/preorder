import { useState } from 'react';
import { NavLink, Outlet, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useCart } from '../cart.jsx';
import { useApi } from '../hooks.js';
import { date } from '../format.js';
import { Countdown } from '../pages/Shop.jsx';
import CartDrawer from './CartDrawer.jsx';

const Icon = ({ d, children }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d ? <path d={d} /> : children}</svg>
);
const SearchIcon = () => <Icon><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></Icon>;
const UserIcon = () => <Icon><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></Icon>;
const BagIcon = () => <Icon><path d="M5 8h14l-1 12H6L5 8z" /><path d="M9 8V6a3 3 0 016 0v2" /></Icon>;
const MenuIcon = () => <Icon d="M4 7h16M4 12h16M4 17h16" />;

export default function Layout() {
  const { user, info } = useAuth();
  const { count, setOpen } = useCart();
  const { data } = useApi('/periods/current');
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const [searching, setSearching] = useState(false);
  const [menu, setMenu] = useState(false);
  const isStaff = user && ['admin', 'staff'].includes(user.role);
  const period = data?.period;

  const search = (e) => { e.preventDefault(); setSearching(false); nav(q.trim() ? `/?q=${encodeURIComponent(q.trim())}` : '/'); };
  const links = (
    <>
      <NavLink to="/" end onClick={() => setMenu(false)}>Shop</NavLink>
      <NavLink to="/coming-soon" onClick={() => setMenu(false)}>Coming soon</NavLink>
      <NavLink to="/how-it-works" onClick={() => setMenu(false)}>How it works</NavLink>
      <NavLink to="/account" onClick={() => setMenu(false)}>{user ? 'My orders' : 'Track order'}</NavLink>
      {isStaff && <NavLink to="/admin">Admin</NavLink>}
    </>
  );

  return (
    <>
      {period && (
        <div className="announce">
          <Countdown to={period.closes_at} label="Preorders close in" />
          {period.eta_date && <span className="announce-sep">Arrives around {date(period.eta_date)}</span>}
        </div>
      )}
      <header className="sf-header">
        <div className="sf-bar">
          <button className="sf-icon sf-burger" onClick={() => setMenu((m) => !m)} aria-label="Menu" aria-expanded={menu}><MenuIcon /></button>
          <nav className="sf-nav" aria-label="Main">{links}</nav>
          <Link to="/" className="sf-logo">{info.businessName}</Link>
          <div className="sf-actions">
            <button className="sf-icon" onClick={() => setSearching((s) => !s)} aria-label="Search"><SearchIcon /></button>
            <Link to={user ? '/account' : '/login'} className="sf-icon" aria-label={user ? 'Account' : 'Sign in'}><UserIcon /></Link>
            <button className="sf-icon sf-cart" onClick={() => setOpen(true)} aria-label={`Cart, ${count} items`}>
              <BagIcon />{count > 0 && <b>{count}</b>}
            </button>
          </div>
        </div>
        {searching && (
          <form className="sf-search" onSubmit={search} role="search">
            <SearchIcon />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search our products" aria-label="Search products" />
            <button type="button" className="linkbtn" onClick={() => setSearching(false)}>Close</button>
          </form>
        )}
        {menu && <nav className="sf-mobile" aria-label="Menu">{links}</nav>}
      </header>
      <main className="page">
        <Outlet />
      </main>
      <footer className="sf-footer">
        <div className="sf-footer-inner">
          <div className="sf-footer-about">
            <b className="sf-footer-logo">{info.businessName}</b>
            <p>{info.storeTagline}</p>
          </div>
          <div><h4>Shop</h4><Link to="/">Preorder items</Link><Link to="/coming-soon">Coming soon</Link><Link to="/how-it-works">How it works</Link></div>
          <div><h4>Your order</h4><Link to="/account">Track an order</Link><Link to="/login">Sign in</Link></div>
          <div><h4>Collection</h4><span>{info.shopLocation}</span><span>Pay with M-Pesa</span></div>
        </div>
        <div className="sf-footer-base">© {new Date().getFullYear()} {info.businessName}</div>
      </footer>
      <CartDrawer />
    </>
  );
}
