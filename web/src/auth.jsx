import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, getToken, setToken } from './api.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!getToken());
  const [info, setInfo] = useState({ businessName: 'Preorder', collectionTitle: 'Available for preorder', storeHeadline: '', storeTagline: '' });

  useEffect(() => {
    api('/info').then((i) => { setInfo(i); document.title = i.businessName; }).catch(() => {});
    if (getToken()) {
      api('/auth/me').then((d) => setUser(d.user)).catch(() => setToken(null)).finally(() => setLoading(false));
    }
    const onLogout = () => setUser(null);
    window.addEventListener('auth:logout', onLogout);
    return () => window.removeEventListener('auth:logout', onLogout);
  }, []);

  const login = useCallback((token, u) => { setToken(token); setUser(u); }, []);
  const logout = useCallback(() => { setToken(null); setUser(null); }, []);

  return (
    <AuthCtx.Provider value={{ user, setUser, loading, login, logout, info }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
