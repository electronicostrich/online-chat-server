import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { AuthSessionUser } from '../api/auth.js';
import { fetchCurrentSession, login, logout } from '../api/auth.js';

export interface SessionState {
  status: 'loading' | 'signed-in' | 'signed-out';
  user: AuthSessionUser | null;
}

interface SessionContextValue extends SessionState {
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }): ReactElement {
  const [state, setState] = useState<SessionState>({ status: 'loading', user: null });

  useEffect(() => {
    // Use a mutable holder so TS doesn't narrow the literal `false` away in
    // the async callback below.
    const lifecycle = { cancelled: false };
    void (async () => {
      try {
        const current = await fetchCurrentSession();
        if (lifecycle.cancelled) return;
        if (current === null) {
          setState({ status: 'signed-out', user: null });
        } else {
          // The /sessions endpoint doesn't return user info — we know the
          // caller is signed in but won't have the username until they
          // sign in via the form (or until an /auth/me endpoint lands).
          setState({ status: 'signed-in', user: null });
        }
      } catch {
        // Any failure on the boot probe (401 unauthenticated, network down,
        // CORS, parse error) lands the user on the sign-in screen — that's
        // the correct fallback regardless of cause.
        if (lifecycle.cancelled) return;
        setState({ status: 'signed-out', user: null });
      }
    })();
    return () => {
      lifecycle.cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const data = await login({ email, password });
    setState({ status: 'signed-in', user: data.user });
  }, []);

  const signOut = useCallback(async () => {
    await logout();
    setState({ status: 'signed-out', user: null });
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({ ...state, signIn, signOut }),
    [state, signIn, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (value === null) {
    throw new Error('useSession must be used inside <SessionProvider>');
  }
  return value;
}
