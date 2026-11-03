import { useState } from 'react';
import { api, DEMO } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useAction } from '../hooks.js';
import { Err } from './ui.jsx';

// Phone number + 6-digit code. Creates the customer on first use.
export default function AuthForm({ onDone, submitLabel = 'Continue' }) {
  const { login } = useAuth();
  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [isNew, setIsNew] = useState(false);
  const [devCode, setDevCode] = useState(null);
  const { busy, error, setError, run } = useAction();

  const requestCode = (e) => {
    e?.preventDefault();
    run(async () => {
      const r = await api('/auth/request-otp', { method: 'POST', body: { phone } });
      setIsNew(r.isNew);
      setDevCode(r.devCode || null);
      setStep('code');
    });
  };

  const verify = (e) => {
    e.preventDefault();
    if (isNew && !name.trim()) return setError('Enter your name');
    run(async () => {
      const r = await api('/auth/verify-otp', { method: 'POST', body: { phone, code, name } });
      login(r.token, r.user);
      onDone?.(r.user);
    });
  };

  if (step === 'phone') {
    return (
      <form onSubmit={requestCode}>
        {DEMO && (
          <div className="demo-quick">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPhone('0799123456')}>Try as a customer</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPhone('0700000001')}>Try as admin</button>
          </div>
        )}
        <Err msg={error} />
        <label className="field">
          <span>Mobile number</span>
          <input type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678"
            value={phone} onChange={(e) => setPhone(e.target.value)} required />
          <small>We'll text you a 6-digit code.</small>
        </label>
        <button className="btn btn-block" disabled={busy}>{busy ? 'Sending…' : submitLabel}</button>
      </form>
    );
  }
  return (
    <form onSubmit={verify}>
      <p className="muted small">Code sent to {phone}. <button type="button" className="linkbtn" onClick={() => { setStep('phone'); setCode(''); }}>Change</button></p>
      {devCode && <div className="alert alert-info">{DEMO ? 'Demo' : 'Dev mode'}: your code is <b>{devCode}</b> <button type="button" className="linkbtn" onClick={() => setCode(devCode)}>Fill it in</button></div>}
      <Err msg={error} />
      {isNew && (
        <label className="field">
          <span>Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
        </label>
      )}
      <label className="field">
        <span>6-digit code</span>
        <input className="otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
          value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required autoFocus />
      </label>
      <button className="btn btn-block" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Verify'}</button>
      <p className="small muted" style={{ marginTop: 12 }}>
        No code? <button type="button" className="linkbtn" onClick={requestCode} disabled={busy}>Send again</button>
      </p>
    </form>
  );
}
