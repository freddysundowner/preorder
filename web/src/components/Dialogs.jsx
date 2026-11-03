import { useEffect, useRef, useState } from 'react';

// In-page replacements for window.confirm and file downloads.
let open = null;

/** Ask the user to confirm. Resolves true or false. */
export function ask(message, { confirmLabel = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    if (!open) return resolve(window.confirm(message));
    open({ kind: 'confirm', message, confirmLabel, danger, resolve });
  });
}

/** Show a block of text (e.g. CSV) with a copy button. */
export function showText(title, text) {
  if (open) open({ kind: 'text', title, text, resolve: () => {} });
}

export function DialogHost() {
  const [d, setD] = useState(null);
  const [copied, setCopied] = useState(false);
  const btn = useRef(null);
  useEffect(() => { open = (x) => { setCopied(false); setD(x); }; return () => { open = null; }; }, []);
  useEffect(() => { if (d) btn.current?.focus(); }, [d]);
  useEffect(() => {
    if (!d) return;
    const onKey = (e) => { if (e.key === 'Escape') close(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  if (!d) return null;

  function close(v) { d.resolve(v); setD(null); }
  const copy = async () => {
    try { await navigator.clipboard.writeText(d.text); setCopied(true); }
    catch { document.getElementById('dialog-text')?.select(); }
  };

  return (
    <>
      <div className="drawer-bg" onClick={() => close(false)} />
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        {d.kind === 'confirm' ? (
          <>
            <p id="dialog-title" style={{ whiteSpace: 'pre-line' }}>{d.message}</p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => close(false)}>Go back</button>
              <button ref={btn} className={`btn ${d.danger ? 'btn-danger-solid' : ''}`} onClick={() => close(true)}>{d.confirmLabel}</button>
            </div>
          </>
        ) : (
          <>
            <h2 id="dialog-title">{d.title}</h2>
            <p className="small muted">Copy this and paste it into Excel or Google Sheets.</p>
            <textarea id="dialog-text" readOnly value={d.text} style={{ minHeight: 180, fontSize: '.82rem', fontFamily: 'ui-monospace, Menlo, Consolas, monospace' }} />
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn btn-ghost" onClick={() => close(false)}>Close</button>
              <button ref={btn} className="btn" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
