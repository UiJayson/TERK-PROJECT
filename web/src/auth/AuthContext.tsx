import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  fetchSession,
  loginAccount,
  logoutAccount,
  registerAccount,
} from "./api";
import { captureException, setSentryUser } from "../lib/sentry";
import type { AuthSession, PublicUser, PublicWorkspace, WorkspaceRole } from "./types";

interface AuthContextValue {
  user: PublicUser | null;
  workspace: PublicWorkspace | null;
  role: WorkspaceRole | null;
  loading: boolean;
  isAuthenticated: boolean;
  login: (input: { email: string; password: string }) => Promise<void>;
  register: (input: {
    name: string;
    email: string;
    password: string;
    companyName: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const next = await fetchSession();
    setSession(next);
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const next = await fetchSession();
        if (active) setSession(next);
      } catch (error) {
        void captureException(error);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (input: { email: string; password: string }) => {
    const next = await loginAccount(input);
    setSession(next);
  }, []);

  const register = useCallback(
    async (input: {
      name: string;
      email: string;
      password: string;
      companyName: string;
    }) => {
      const next = await registerAccount(input);
      setSession(next);
    },
    [],
  );

  const logout = useCallback(async () => {
    await logoutAccount();
    setSession(null);
  }, []);

  useEffect(() => {
    if (session?.user) {
      setSentryUser({
        id: session.user.id,
        workspaceId: session.workspace?.id,
      });
    }
  }, [session?.user?.id, session?.workspace?.id]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      workspace: session?.workspace ?? null,
      role: session?.role ?? null,
      loading,
      isAuthenticated: Boolean(session),
      login,
      register,
      logout,
      refresh,
    }),
    [session, loading, login, register, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
