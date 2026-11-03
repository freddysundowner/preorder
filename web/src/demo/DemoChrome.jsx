import { useEffect, useState } from 'react';
import { useAuth } from '../auth.jsx';
import { ask } from '../components/Dialogs.jsx';
import { resetDemo, DEMO_ADMIN_PHONE } from './mockServer.js';

let toastId = 0;

// Top strip explaining the demo, and SMS "phone notifications" as toasts
export default function DemoChrome() {
  const { user, logout } = useAuth();
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const onSms = (e) => {
      const { messages } = e.detail;
      const mine = user ? messages.filter((m) => m.phone === user.phone) : [];
      const others = messages.length - mine.length;
      const add = [];
      for (const m of mine) add.push({ id: ++toastId, kind: 'mine', body: m.body });
      if (others > 0 && user && user.role !== 'customer') {
        add.push({ id: ++toastId, kind: 'others', body: `${others} SMS sent to customers. See them in the SMS log.` });
      }
      if (!add.length) return;
      setToasts((t) => [...t, ...add].slice(-3));
      for (const a of add) setTimeout(() => setToasts((t) => t.filter((x) => x.id !== a.id)), a.kind === 'mine' ? 9000 : 5000);
    };
    window.addEventListener('demo:sms', onSms);
    return () => window.removeEventListener('demo:sms', onSms);
  }, [user]);

  const reset = async () => {
    if (!(await ask('Reset the demo? Orders, payments and changes you made will be cleared and the sample data restored.', { confirmLabel: 'Reset demo', danger: true }))) return;
    resetDemo();
    logout();
  };

  return (
    <>
      <div className="demobar">
        <div className="demobar-inner">
          <span><b>Demo</b> · M-Pesa and SMS are simulated and your changes stay in this browser.</span>
          <span className="demobar-right">
            <span>Admin login: <b className="num">{DEMO_ADMIN_PHONE}</b></span>
            <button className="linkbtn" onClick={reset}>Reset demo</button>
          </span>
        </div>
      </div>
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === 'mine' && <span className="toast-from">SMS to your phone</span>}
            <span>{t.body}</span>
            <button className="toast-x" aria-label="Dismiss" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>×</button>
          </div>
        ))}
      </div>
    </>
  );
}
