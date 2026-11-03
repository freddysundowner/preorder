import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

// Load data from an API path; returns { data, error, loading, reload, setData }
export function useApi(path, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api(path));
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

// Run an action, tracking busy state and error message
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = useCallback(async (fn) => {
    setBusy(true); setError(null);
    try { return await fn(); } catch (e) { setError(e.message); return undefined; } finally { setBusy(false); }
  }, []);
  return { busy, error, setError, run };
}
