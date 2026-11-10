import type { Session } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "../lib/supabase";
import { profileService } from "../services/admin";
import type { Profile } from "../types";

interface AuthValue {
  session: Session | null;
  loading: boolean;
  profile: Profile | undefined;
  profileError: Error | null;
  recovery: boolean;
  clearRecovery: () => void;
  signOut: () => Promise<void>;
  refreshProfile: () => void;
}

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (event === "SIGNED_OUT") qc.clear();
      setSession(s);
    });
    return () => data.subscription.unsubscribe();
  }, [qc]);

  const uid = session?.user.id;
  const profileQ = useQuery({ queryKey: ["me", uid], queryFn: profileService.me, enabled: !!uid, retry: 1, staleTime: 60_000 });

  const value = useMemo<AuthValue>(
    () => ({
      session,
      loading: loading || (!!uid && profileQ.isLoading),
      profile: profileQ.data,
      profileError: profileQ.error as Error | null,
      recovery,
      clearRecovery: () => setRecovery(false),
      signOut: async () => {
        await supabase.auth.signOut();
      },
      refreshProfile: () => qc.invalidateQueries({ queryKey: ["me"] }),
    }),
    [session, loading, uid, profileQ.isLoading, profileQ.data, profileQ.error, recovery, qc],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
