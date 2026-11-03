import { NavLink, Outlet, Link } from 'react-router-dom';
import { useAuth } from '../../auth.jsx';

export default function AdminLayout() {
  const { user, info } = useAuth();
  const isAdmin = user.role === 'admin';
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/admin" className="brand">{info.businessName} admin</Link>
          <span style={{ flex: 1 }} />
          <Link to="/" className="cart-pill">Customer view</Link>
        </div>
      </header>
      <div className="admin">
        <nav className="sidebar" aria-label="Admin">
          <NavLink to="/admin" end>Overview</NavLink>
          {isAdmin && <NavLink to="/admin/periods">Shipping rounds</NavLink>}
          <NavLink to="/admin/orders">Orders</NavLink>
          {isAdmin && <NavLink to="/admin/payments">Payments</NavLink>}
          <NavLink to="/admin/collections">Collection desk</NavLink>
          <hr />
          {isAdmin && <NavLink to="/admin/proposed">Coming soon items</NavLink>}
          {isAdmin && <NavLink to="/admin/sms">Messages</NavLink>}
          {isAdmin && <NavLink to="/admin/people">People</NavLink>}
          {isAdmin && <NavLink to="/admin/settings">Settings</NavLink>}
        </nav>
        <main className="admin-main">
          <Outlet />
        </main>
      </div>
    </>
  );
}
