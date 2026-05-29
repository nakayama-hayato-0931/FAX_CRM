import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import { api, setAuthToken, getAuthToken } from '@/utils/api';

const AuthContext = createContext({
  user: null,
  loading: true,
  isAdmin: false,
  login: async () => {},
  logout: () => {},
  refresh: async () => {},
});

export function AuthProvider({ children }) {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const token = getAuthToken();
    if (!token) { setUser(null); setLoading(false); return; }
    try {
      const { data } = await api.get('/api/auth/me');
      setUser(data.data?.user || null);
    } catch (_e) {
      setUser(null);
      setAuthToken(null);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = useCallback(async (username, password) => {
    const { data } = await api.post('/api/auth/login', { username, password });
    const token = data.data?.token;
    const u = data.data?.user;
    if (!token || !u) throw new Error('ログイン応答が不正');
    setAuthToken(token);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(() => {
    setAuthToken(null);
    setUser(null);
    if (typeof window !== 'undefined') window.location.href = '/login';
  }, []);

  const value = {
    user,
    loading,
    isAdmin: user?.role === 'admin',
    login,
    logout,
    refresh,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

/**
 * ページレベル ガード:
 *   user が null なら /login へ。 role 指定があれば不一致時 / (ホーム) へ。
 *   sales が admin 専用ページに来た場合は /reports にリダイレクト。
 */
export function useRequireAuth({ role } = {}) {
  const router = useRouter();
  const { user, loading } = useAuth();
  useEffect(() => {
    if (loading) return;
    if (!user) {
      const next = encodeURIComponent(router.asPath || '/');
      router.replace(`/login?next=${next}`);
      return;
    }
    if (role && user.role !== role) {
      router.replace(user.role === 'sales' ? '/reports' : '/');
    }
  }, [loading, user, role, router]);
  return { user, loading };
}
