import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  currentPuterUser,
  ensurePuter,
  signInWithPuter,
  signOutPuter,
  type PuterUser,
} from "@/lib/puter";

type PuterContextValue = {
  ready: boolean;
  signedIn: boolean;
  user: PuterUser | null;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const PuterContext = createContext<PuterContextValue | null>(null);

export function PuterProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [user, setUser] = useState<PuterUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const puter = await ensurePuter();
      const ok = puter.auth.isSignedIn();
      setSignedIn(ok);
      setUser(ok ? await currentPuterUser() : null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Puter failed to load.");
      setSignedIn(false);
      setUser(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(async () => {
    setError(null);
    try {
      const next = await signInWithPuter(true);
      setSignedIn(Boolean(next));
      setUser(next);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign-in failed.";
      setError(msg);
      throw err;
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await signOutPuter();
    } finally {
      setSignedIn(false);
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ ready, signedIn, user, error, signIn, signOut, refresh }),
    [ready, signedIn, user, error, signIn, signOut, refresh],
  );

  return <PuterContext.Provider value={value}>{children}</PuterContext.Provider>;
}

export function usePuter() {
  const ctx = useContext(PuterContext);
  if (!ctx) throw new Error("usePuter must be used within PuterProvider");
  return ctx;
}
