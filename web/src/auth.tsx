import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { api, setUnauthorizedHandler, TOKEN_KEY, USER_KEY } from './api';
import type { Role } from './types';
import { closeSocket } from './socket';
import { unsubscribeBrowser } from './notifications';

export interface AuthUser {
  id: string;
  fullName: string;
  role: Role;
}

interface AuthContextValue {
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  // after a password change the server issues a new token for this browser
  replaceToken: (token: string) => void;
  logoutEverywhere: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredUser(): AuthUser | null {
  try {
    const raw = sessionStorage.getItem(USER_KEY);
    return raw && sessionStorage.getItem(TOKEN_KEY)
      ? (JSON.parse(raw) as AuthUser)
      : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(readStoredUser);

  const logout = useCallback(() => {
    // this browser stops getting the account's pushes (best effort)
    void unsubscribeBrowser(sessionStorage.getItem(TOKEN_KEY));
    closeSocket();
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<{ accessToken: string; user: AuthUser }>(
      '/auth/login',
      { email, password },
    );
    const { accessToken, user: u } = res.data;
    // the backend enforces roles too; this just gives a clear message
    if (u.role !== 'COORDINATOR' && u.role !== 'ADMIN') {
      throw new Error(
        'This dashboard is for coordinators and administrators. Please use the mobile app.',
      );
    }
    const safeUser: AuthUser = { id: u.id, fullName: u.fullName, role: u.role };
    sessionStorage.setItem(TOKEN_KEY, accessToken);
    sessionStorage.setItem(USER_KEY, JSON.stringify(safeUser));
    setUser(safeUser);
  }, []);

  const replaceToken = useCallback((token: string) => {
    sessionStorage.setItem(TOKEN_KEY, token);
    closeSocket(); // reconnects with the new token on next use
    window.dispatchEvent(new Event('facilitrack:session-renewed'));
  }, []);

  const logoutEverywhere = useCallback(async () => {
    await api.post('/auth/logout-all');
    logout();
  }, [logout]);

  const value = useMemo(
    () => ({ user, login, logout, replaceToken, logoutEverywhere }),
    [user, login, logout, replaceToken, logoutEverywhere],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}