import { api } from "../lib/api";
import type { Alarm, AlarmCounts } from "../types";

export interface AlarmFilters {
  state?: "active" | "cleared" | "all";
  priority?: string;
  kind?: string;
  ward_id?: string;
  acknowledged?: boolean;
  q?: string;
  limit?: number;
}

export const alarmService = {
  list: (f: AlarmFilters = {}) => api.get<Alarm[]>("/alarms", { ...f }),
  forPatient: (patientId: string) => api.get<Alarm[]>(`/patients/${patientId}/alarms`),
  counts: () => api.get<AlarmCounts>("/alarms/counts"),
  acknowledge: (id: string, note?: string) => api.post<Alarm>(`/alarms/${id}/acknowledge`, { note: note || null }),
};
