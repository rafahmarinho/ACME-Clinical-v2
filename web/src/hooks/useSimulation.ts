import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { simulationService } from "../services/admin";
import type { AlarmCounts, Preferences, SimState } from "../types";

/** Simulation clock state, read directly from Supabase (RLS: authenticated read-only). */
export function useSimState(enabled = true) {
  return useQuery({
    queryKey: ["sim-state"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from("sim_state").select("*").eq("id", 1).single();
      if (error) throw error;
      return data as SimState;
    },
    refetchInterval: 15_000,
  });
}

/**
 * While the live simulation is running, every open client asks the API to tick.
 * The API de-duplicates, so the clock advances once per interval regardless of viewers.
 */
export function useSimulationDriver(state: SimState | undefined) {
  const busy = useRef(false);
  useEffect(() => {
    if (!state?.running) return;
    const ms = Math.max(2, state.tick_seconds) * 1000;
    const fire = async () => {
      if (busy.current || document.hidden) return;
      busy.current = true;
      try {
        await simulationService.tick();
      } catch {
        /* transient: next interval retries */
      } finally {
        busy.current = false;
      }
    };
    fire();
    const id = window.setInterval(fire, ms);
    return () => window.clearInterval(id);
  }, [state?.running, state?.tick_seconds]);
}

/** Audible alert for unacknowledged high-priority alarms (respects user preferences). */
export function useAlarmTone(counts: AlarmCounts | undefined, prefs: Preferences | undefined) {
  const ctx = useRef<AudioContext | null>(null);
  useEffect(() => {
    if (!prefs?.alarm_sound || !counts?.high_unacknowledged) return;
    const beep = () => {
      try {
        ctx.current ??= new AudioContext();
        const ac = ctx.current;
        const vol = (prefs.alarm_volume ?? 70) / 100;
        [0, 0.18, 0.36].forEach((offset) => {
          const o = ac.createOscillator();
          const g = ac.createGain();
          o.frequency.value = 880;
          o.type = "triangle";
          g.gain.setValueAtTime(0.0001, ac.currentTime + offset);
          g.gain.exponentialRampToValueAtTime(0.25 * vol + 0.0001, ac.currentTime + offset + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + offset + 0.14);
          o.connect(g).connect(ac.destination);
          o.start(ac.currentTime + offset);
          o.stop(ac.currentTime + offset + 0.15);
        });
      } catch {
        /* audio not available */
      }
    };
    beep();
    const id = window.setInterval(beep, 6000);
    return () => window.clearInterval(id);
  }, [counts?.high_unacknowledged, prefs?.alarm_sound, prefs?.alarm_volume]);
}
