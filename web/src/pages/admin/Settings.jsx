import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useApi, useAction } from '../../hooks.js';
import { useAuth } from '../../auth.jsx';
import { Err, Ok, Loading } from '../../components/ui.jsx';

const GROUPS = [
  ['store', 'Store', 'Name, banner text and collection point shown across the shop and in messages.'],
  ['sms', 'SMS', 'Pick who sends your text messages. Customers get order updates and pickup codes by SMS.'],
  ['email', 'Email', 'Send every notification by email too, through Brevo, to customers who gave an email address.'],
  ['payments', 'Payments', 'Choose how customers pay. They always get an M-Pesa prompt on their phone.'],
];

function Field({ f, value, onChange }) {
  if (f.bool) {
    return (
      <label className="check field">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        <span><b>{f.label}</b>{f.hint && <small>{f.hint}</small>}</span>
      </label>
    );
  }
  return (
    <label className="field">
      <span>{f.label}</span>
      {f.options ? (
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      ) : f.long ? (
        <textarea rows={2} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input
          type={f.secret ? 'password' : 'text'} autoComplete="off" value={value ?? ''}
          placeholder={f.secret && f.isSet ? `${f.hint2} (saved, type to replace)` : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {f.hint && <small>{f.hint}</small>}
    </label>
  );
}

function TestBox({ group }) {
  const [to, setTo] = useState('');
  const { busy, error, setError, run } = useAction();
  const [ok, setOk] = useState(null);
  if (group !== 'sms' && group !== 'email') return null;
  const isSms = group === 'sms';
  const send = () => run(async () => {
    setOk(null);
    const r = await api(`/admin/settings/test-${isSms ? 'sms' : 'email'}`, { method: 'POST', body: isSms ? { phone: to } : { email: to } });
    setOk(r.message);
  });
  return (
    <div className="testbox panel">
      <h3>Send a test {isSms ? 'SMS' : 'email'}</h3>
      <p className="small muted">Save your changes first, then send a test to check they work.</p>
      <Err msg={error} /><Ok msg={ok} />
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: 1, marginBottom: 0 }}>
          <span>{isSms ? 'Phone number' : 'Email address'}</span>
          <input value={to} onChange={(e) => { setTo(e.target.value); setError(null); }} type={isSms ? 'tel' : 'email'} />
        </label>
        <button className="btn btn-ghost" onClick={send} disabled={busy || !to}>{busy ? 'Sending…' : 'Send test'}</button>
      </div>
    </div>
  );
}

export default function Settings() {
  const { data, error, loading, reload } = useApi('/admin/settings');
  const { info } = useAuth();
  const [tab, setTab] = useState('store');
  const [vals, setVals] = useState({});
  const [saved, setSaved] = useState(null);
  const { busy, error: saveErr, run } = useAction();

  useEffect(() => {
    if (data) setVals(Object.fromEntries(data.fields.map((f) => [f.key, f.value])));
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error) return <Err msg={error} />;

  const fields = data.fields.filter((f) => f.group === tab);
  const dirty = fields.some((f) => vals[f.key] !== f.value);
  const [, , blurb] = GROUPS.find((g) => g[0] === tab);
  const provider = vals.smsProvider;
  const payProvider = vals.paymentProvider;

  const save = () => run(async () => {
    const changes = {};
    for (const f of fields) if (vals[f.key] !== f.value) changes[f.key] = vals[f.key];
    await api('/admin/settings', { method: 'PUT', body: { changes } });
    setSaved('Saved.');
    setTimeout(() => setSaved(null), 3000);
    reload();
  });

  const visible = (f) => {
    if (tab === 'payments') {
      if (['paymentProvider', 'publicApiUrl'].includes(f.key)) return payProvider !== 'mock' || f.key === 'paymentProvider';
      if (f.key.startsWith('mpesa')) return payProvider === 'daraja';
      if (f.key.startsWith('sunpay')) {
        if (f.key === 'sunpaySettleShortcode' || f.key === 'sunpaySettleAccount') return payProvider === 'sunpay' && vals.sunpaySettleType !== 'none' && (f.key === 'sunpaySettleShortcode' || vals.sunpaySettleType === 'paybill');
        return payProvider === 'sunpay';
      }
    }
    if (tab !== 'sms' || f.key === 'smsProvider') return true;
    if (f.key.startsWith('blessed')) return provider === 'blessedtexts';
    if (f.key.startsWith('at')) return provider === 'africastalking';
    return true;
  };

  return (
    <div className="stack">
      <h1>Settings</h1>
      <div className="tabs" role="tablist">
        {GROUPS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setSaved(null); }}>{label}</button>
        ))}
      </div>
      <section className="panel settings-panel">
        <p className="muted">{blurb}</p>
        <Err msg={saveErr} /><Ok msg={saved} />
        {fields.filter(visible).map((f) => (
          <Field key={f.key} f={f} value={vals[f.key]} onChange={(v) => setVals((s) => ({ ...s, [f.key]: v }))} />
        ))}
        {tab === 'sms' && provider === 'blessedtexts' && <p className="small muted">Find your API key and register your sender ID in your BlessedTexts account.</p>}
        {tab === 'email' && <p className="small muted">Create an API key in Brevo (SMTP &amp; API), and verify your sender email there first.</p>}
        {tab === 'payments' && payProvider === 'mock' && <div className="alert alert-warn">Test mode: no real money moves. Pressing Pay marks the order as paid after a few seconds. Switch before you go live.</div>}
        {tab === 'payments' && payProvider === 'daraja' && data.urls && (
          <div className="alert alert-info"><b>Daraja callback addresses</b> (set these in your Safaricom app):
            <div className="small" style={{ wordBreak: 'break-all', marginTop: 6 }}>STK: {data.urls.darajaStk}<br />Paybill confirmation: {data.urls.darajaC2b}</div>
            <p className="small" style={{ margin: '8px 0 0' }}>If you change the website address or callback secret, register the Paybill addresses again.</p>
          </div>
        )}
        {tab === 'payments' && payProvider === 'sunpay' && data.urls && (
          <div className="alert alert-info">Payment results reach you automatically at <span className="small" style={{ wordBreak: 'break-all' }}>{data.urls.sunpay}</span>.
            If you also add a signed webhook in your SunPay dashboard, use <span className="small" style={{ wordBreak: 'break-all' }}>{data.urls.sunpaySigned}</span> and paste its secret above.
          </div>
        )}
        <button className="btn" onClick={save} disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save changes'}</button>
      </section>
      <TestBox group={tab} />
    </div>
  );
}
