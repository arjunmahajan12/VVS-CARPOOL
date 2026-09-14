// Auth context (v8). One source of truth for "who is signed in" and whether
// they still need onboarding. Screens never call api.signIn directly.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import type { Profile, RegisterData, SignInResult } from "../lib/types";

export interface AuthState {
  /** Signed-in profile (parent / admin / add-on). Pending & rejected families are still `user`s. */
  user: Profile | null;
  /** True until the first getProfile() round-trip finishes. */
  loading: boolean;
  /** Signed in with an email the school has never seen → Onboarding. */
  needsOnboarding: boolean;
  /** The email used to sign in / sign up (available during onboarding). */
  email: string | null;
  signIn: (email: string, password: string) => Promise<SignInResult>;
  signUp: (email: string, password: string) => Promise<SignInResult>;
  register: (data: RegisterData) => Promise<Profile>;
  refresh: () => Promise<Profile | null>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>");
  return v;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<Profile | null> => {
    try {
      const p = await api.getProfile();
      if (p) { setUser(p); setNeedsOnboarding(false); setEmail(p.email); }
      else setUser(null);
      return p;
    } catch {
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    refresh().finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [refresh]);

  const apply = useCallback((em: string, res: SignInResult) => {
    setEmail(em.trim().toLowerCase());
    if (res.status === "new") { setUser(null); setNeedsOnboarding(true); }
    else { setUser(res.profile); setNeedsOnboarding(false); }
    return res;
  }, []);

  const signIn = useCallback(async (em: string, password: string) => apply(em, await api.signIn(em.trim(), password)), [apply]);
  const signUp = useCallback(async (em: string, password: string) => apply(em, await api.signUp(em.trim(), password)), [apply]);

  const register = useCallback(async (data: RegisterData) => {
    if (!email) throw new Error("Sign in first");
    const profile = await api.register(email, data);
    setUser(profile); setNeedsOnboarding(false);
    return profile;
  }, [email]);

  const signOut = useCallback(async () => {
    try { await api.signOut(); } catch { /* signing out never fails the UI */ }
    setUser(null); setNeedsOnboarding(false); setEmail(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, loading, needsOnboarding, email, signIn, signUp, register, refresh, signOut }),
    [user, loading, needsOnboarding, email, signIn, signUp, register, refresh, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
