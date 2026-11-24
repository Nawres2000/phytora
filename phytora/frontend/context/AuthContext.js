'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '@/lib/api';

const Ctx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try { const d = await api('/auth/me'); setUser(d.user); return d.user; }
    catch { setUser(null); return null; }
    finally { setReady(true); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const logout = async () => {
    try { await api('/auth/signout', { method: 'POST' }); } catch {}
    setUser(null);
    window.location.href = '/';
  };

  return <Ctx.Provider value={{ user, setUser, ready, refresh, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
