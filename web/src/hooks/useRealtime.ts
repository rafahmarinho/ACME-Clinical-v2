import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

/** Query keys refreshed when a table changes (Supabase Realtime → React Query). */
const TABLE_KEYS: Record<string, string[][]> = {
  monitor_state: [["live"], ["wards"], ["patient"], ["patients"], ["vitals"]],
  alarms: [["alarms"], ["alarm-counts"], ["live"], ["wards"], ["patient"], ["patients"], ["patient-alarms"], ["monitors"]],
  monitors: [["monitors"], ["monitor"], ["live"], ["wards"], ["simulation"]],
  events: [["events"], ["monitor"]],
  sim_state: [["simulation"], ["sim-state"]],
  observations: [["observations"]],
};

export type RealtimeStatus = "connecting" | "live" | "offline";

export function useRealtimeSync(enabled: boolean): RealtimeStatus {
  const qc = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const pending = useRef<Set<string>>(new Set());
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const flush = () => {
      timer.current = null;
      const tables = [...pending.current];
      pending.current.clear();
      const keys = new Map<string, string[]>();
      tables.forEach((t) => TABLE_KEYS[t]?.forEach((k) => keys.set(k.join("|"), k)));
      keys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
    };
    const channel = supabase.channel("acme-central-station");
    Object.keys(TABLE_KEYS).forEach((table) => {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        pending.current.add(table);
        if (timer.current === null) timer.current = window.setTimeout(flush, 400);
      });
    });
    channel.subscribe((s) => setStatus(s === "SUBSCRIBED" ? "live" : s === "CLOSED" || s === "CHANNEL_ERROR" || s === "TIMED_OUT" ? "offline" : "connecting"));
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
      supabase.removeChannel(channel);
    };
  }, [enabled, qc]);

  return status;
}
