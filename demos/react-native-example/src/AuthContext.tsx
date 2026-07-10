import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { PortalAuthState } from '@amthal-group/portal-react-native';
import { login as apiLogin } from './api/auth';

/**
 * Minimal in-memory auth store.
 *
 * NOTE (production): keep tokens in memory for the session, but persist them
 * with react-native-keychain (iOS Keychain / Android Keystore) or
 * react-native-encrypted-storage — never AsyncStorage — if you need them to
 * survive app restarts.
 */

interface AuthContextValue {
  /** Null while signed out. */
  auth: PortalAuthState | null;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => void;
  /** Replace the stored credentials (e.g. after a token refresh). */
  setAuth: (auth: PortalAuthState) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuthState] = useState<PortalAuthState | null>(null);

  const signIn = useCallback(async (username: string, password: string) => {
    const tokens = await apiLogin(username, password);
    setAuthState({ token: tokens.token, branchId: tokens.branchId });
  }, []);

  const signOut = useCallback(() => setAuthState(null), []);

  const setAuth = useCallback((next: PortalAuthState) => setAuthState(next), []);

  const value = useMemo(
    () => ({ auth, signIn, signOut, setAuth }),
    [auth, signIn, signOut, setAuth],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
