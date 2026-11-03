import { useRef, useState } from 'react';
import { uploadImage } from '../api.js';
import { ProductImage } from './ui.jsx';

// Photo picker for admin forms: upload a file or paste a link
export default function ImageField({ value, name, onChange }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const pick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setErr(null);
    try { onChange(await uploadImage(file)); } catch (x) { setErr(x.message); } finally { setBusy(false); e.target.value = ''; }
  };

  return (
    <div className="field imagefield">
      <span>Photo</span>
      <div className="imagefield-row">
        <ProductImage src={value} name={name} className="thumb" />
        <div className="grow">
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={pick} hidden />
          <div className="row">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => input.current.click()} disabled={busy}>{busy ? 'Uploading…' : value ? 'Replace photo' : 'Upload photo'}</button>
            {value && <button type="button" className="linkbtn" onClick={() => onChange('')}>Remove</button>}
          </div>
          {err && <small style={{ color: 'var(--red)' }}>{err}</small>}
        </div>
      </div>
    </div>
  );
}
