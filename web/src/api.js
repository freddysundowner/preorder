import { showText } from './components/Dialogs.jsx';

export const DEMO = import.meta.env.VITE_DEMO === '1';
const TOKEN_KEY = 'preorder_token';
let memToken = null;

export const getToken = () => {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return memToken; }
};
export const setToken = (t) => {
  memToken = t;
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
};

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function send(path, method, body, token) {
  if (DEMO) {
    const { handle } = await import('./demo/mockServer.js');
    return handle(method, path, body, token);
  }
  const res = await fetch('/api' + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

export async function api(path, { method = 'GET', body } = {}) {
  const token = getToken();
  const { status, data } = await send(path, method, body, token);
  if (status === 401 && token) {
    setToken(null);
    window.dispatchEvent(new Event('auth:logout'));
  }
  if (status >= 400) throw new ApiError(status, data.error || 'Something went wrong');
  return data;
}

// Upload an image (admin). Returns the URL to store on the product.
export async function uploadImage(file) {
  if (DEMO) return URL.createObjectURL(file);
  const res = await fetch('/api/admin/upload', {
    method: 'POST',
    headers: { 'Content-Type': file.type, Authorization: `Bearer ${getToken()}` },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || 'Upload failed');
  return data.url;
}

// Download a file (e.g. CSV). In the demo, show it for copying instead.
export async function download(path, filename) {
  if (DEMO) {
    const { data } = await send(path, 'GET', null, getToken());
    showText(filename, data.__text || '');
    return;
  }
  const res = await fetch('/api' + path, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new ApiError(res.status, 'Download failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
