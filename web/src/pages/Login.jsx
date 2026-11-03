import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import AuthForm from '../components/AuthForm.jsx';

export default function Login() {
  const { info } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  return (
    <div className="auth-page">
      <Link to="/" className="auth-brand">{info.businessName}</Link>
      <div className="panel auth-card">
        <h1>Sign in</h1>
        <AuthForm submitLabel="Send code" onDone={(u) => nav(loc.state?.from || (['admin', 'staff'].includes(u.role) ? '/admin' : '/'), { replace: true })} />
      </div>
    </div>
  );
}
