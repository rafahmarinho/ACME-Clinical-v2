import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configError =
  !url || !key ? "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy web/.env.example to web/.env.local." : null;

export const supabase = createClient(url ?? "http://localhost", key ?? "missing-key", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  realtime: { params: { eventsPerSecond: 20 } },
});
