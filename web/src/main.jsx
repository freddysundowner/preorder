import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, MemoryRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { DEMO } from './api.js';
import { DialogHost } from './components/Dialogs.jsx';
import { AuthProvider, useAuth } from './auth.jsx';
import { CartProvider } from './cart.jsx';
import HowItWorks from './pages/HowItWorks.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Shop from './pages/Shop.jsx';
import Product from './pages/Product.jsx';
import Checkout from './pages/Checkout.jsx';
import Account from './pages/Account.jsx';
import OrderDetail from './pages/OrderDetail.jsx';
import ComingSoon from './pages/ComingSoon.jsx';
import AdminLayout from './pages/admin/AdminLayout.jsx';
import Overview from './pages/admin/Overview.jsx';
import Periods from './pages/admin/Periods.jsx';
import PeriodDetail from './pages/admin/PeriodDetail.jsx';
import Payments from './pages/admin/Payments.jsx';
import AdminOrders from './pages/admin/AdminOrders.jsx';
import Collections from './pages/admin/Collections.jsx';
import Proposed from './pages/admin/Proposed.jsx';
import SmsLog from './pages/admin/SmsLog.jsx';
import Settings from './pages/admin/Settings.jsx';
import People from './pages/admin/People.jsx';
import './styles.css';

// Demo build only: banner + simulated SMS notifications
const DemoChrome = DEMO ? lazy(() => import('./demo/DemoChrome.jsx')) : null;
// The demo runs inside a hosted page where the URL path can't change
const Router = DEMO ? MemoryRouter : BrowserRouter;

function RequireAuth({ children, roles }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <p className="page muted">Loading…</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (roles && !(user.role === 'admin' || roles.includes(user.role))) return <Navigate to="/" replace />;
  return children;
}

function LoginRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/" replace />;
  return <Login />;
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route element={<Layout />}>
        <Route index element={<Shop />} />
        <Route path="product/:id" element={<Product />} />
        <Route path="checkout" element={<Checkout />} />
        <Route path="cart" element={<Navigate to="/checkout" replace />} />
        <Route path="coming-soon" element={<ComingSoon />} />
        <Route path="how-it-works" element={<HowItWorks />} />
        <Route path="orders" element={<Account />} />
        <Route path="account" element={<Account />} />
        <Route path="orders/:id" element={<RequireAuth><OrderDetail /></RequireAuth>} />
        <Route path="profile" element={<Navigate to="/account" replace />} />
      </Route>
      <Route path="/admin" element={<RequireAuth roles={['staff']}><AdminLayout /></RequireAuth>}>
        <Route index element={<Overview />} />
        <Route path="orders" element={<AdminOrders />} />
        <Route path="collections" element={<Collections />} />
        <Route path="periods" element={<RequireAuth roles={[]}><Periods /></RequireAuth>} />
        <Route path="periods/:id" element={<RequireAuth roles={[]}><PeriodDetail /></RequireAuth>} />
        <Route path="payments" element={<RequireAuth roles={[]}><Payments /></RequireAuth>} />
        <Route path="proposed" element={<RequireAuth roles={[]}><Proposed /></RequireAuth>} />
        <Route path="sms" element={<RequireAuth roles={[]}><SmsLog /></RequireAuth>} />
        <Route path="settings" element={<RequireAuth roles={[]}><Settings /></RequireAuth>} />
        <Route path="people" element={<RequireAuth roles={[]}><People /></RequireAuth>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Router>
      <AuthProvider>
        {DemoChrome && <Suspense fallback={null}><DemoChrome /></Suspense>}
        <CartProvider><App /></CartProvider>
        <DialogHost />
      </AuthProvider>
    </Router>
  </React.StrictMode>
);
