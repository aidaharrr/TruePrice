"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { accountStatus, type AccountStatus, type Tier } from "@/lib/account/limits";
import { AuthDialog, type AuthMode } from "@/components/account/auth-dialog";

type SessionResult = { ok: true } | { ok: false; message: string };

type AccountContextValue = {
  /** false when the Supabase env vars are missing. */
  configured: boolean;
  loading: boolean;
  /** Current Supabase user — a real account or an anonymous guest session. */
  user: User | null;
  /** A real (email) account, not an anonymous guest session. */
  isSignedIn: boolean;
  /** Plan + scan count from `public.profiles`. */
  status: AccountStatus | null;
  /** Makes sure there's a session before scanning: starts an anonymous guest session if needed. */
  ensureSession: () => Promise<SessionResult>;
  setStatus: (status: AccountStatus) => void;
  refreshStatus: () => Promise<void>;
  openAuth: (mode?: AuthMode) => void;
  signOut: () => Promise<void>;
};

const AccountContext = createContext<AccountContextValue | null>(null);

export function useAccount() {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("useAccount must be used inside <AccountProvider>");
  return ctx;
}

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const supabase = getSupabaseBrowser();
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);

  const loadStatus = useCallback(
    async (u: User | null) => {
      if (!supabase || !u) {
        setStatus(null);
        return;
      }
      // RLS lets users read only their own profile row.
      const { data } = await supabase.from("profiles").select("tier, scan_count").eq("id", u.id).maybeSingle();
      setStatus(data ? accountStatus(data.tier as Tier, data.scan_count) : accountStatus("GUEST", 0));
    },
    [supabase],
  );

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getUser().then(async ({ data }) => {
      if (!active) return;
      setUser(data.user);
      await loadStatus(data.user);
      if (active) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      // Defer the query: Supabase recommends not awaiting other calls inside this callback.
      setTimeout(() => void loadStatus(session?.user ?? null), 0);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase, loadStatus]);

  const ensureSession = useCallback(async (): Promise<SessionResult> => {
    if (!supabase) return { ok: false, message: "Accounts aren't configured on this server yet." };
    if (user) return { ok: true };
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error || !data.user) {
      // Anonymous sign-ins may be disabled in the Supabase project: fall back to a real account.
      setAuthMode("sign-up");
      return { ok: false, message: "Create a free account or sign in to start scanning." };
    }
    setUser(data.user);
    await loadStatus(data.user);
    return { ok: true };
  }, [supabase, user, loadStatus]);

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
    setUser(null);
    setStatus(null);
  }, [supabase]);

  const value = useMemo<AccountContextValue>(
    () => ({
      configured: Boolean(supabase),
      loading,
      user,
      isSignedIn: Boolean(user && !user.is_anonymous),
      status,
      ensureSession,
      setStatus,
      refreshStatus: () => loadStatus(user),
      openAuth: (mode = "sign-in") => setAuthMode(mode),
      signOut,
    }),
    [supabase, loading, user, status, ensureSession, loadStatus, signOut],
  );

  return (
    <AccountContext.Provider value={value}>
      {children}
      {supabase && (
        <AuthDialog
          supabase={supabase}
          mode={authMode}
          onModeChange={setAuthMode}
          onClose={() => setAuthMode(null)}
        />
      )}
    </AccountContext.Provider>
  );
}
