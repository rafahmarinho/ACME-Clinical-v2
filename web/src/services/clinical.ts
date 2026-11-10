import { api } from "../lib/api";
import type { LiveTile, Observation, PatientDetail, PatientRow, TrendPoint, Ward, BedBrief, PatientBrief, MonitorBrief } from "../types";

export interface PatientFilters {
  q?: string;
  ward_id?: string;
  acuity?: string;
  monitored?: boolean;
  alarm?: boolean;
  status?: string;
}

export const clinicalService = {
  wardOverview: () => api.get<{ wards: Ward[] }>("/wards/overview"),
  beds: (free = false) => api.get<(BedBrief & { patient: PatientBrief | null; monitor: MonitorBrief | null })[]>("/beds", { free }),
  patients: (f: PatientFilters = {}) => api.get<PatientRow[]>("/patients", { ...f }),
  patient: (id: string) => api.get<PatientDetail>(`/patients/${id}`),
  vitals: (id: string, minutes: number) => api.get<TrendPoint[]>(`/patients/${id}/vitals`, { minutes }),
  observations: (id: string) => api.get<Observation[]>(`/patients/${id}/observations`),
  addObservation: (id: string, body: { category: Observation["category"]; note: string; include_vitals: boolean }) =>
    api.post<Observation>(`/patients/${id}/observations`, body),
  live: (ward_id?: string) => api.get<LiveTile[]>("/monitoring/live", { ward_id }),
  search: (q: string) =>
    api.get<{ patients: PatientRow[]; monitors: (MonitorBrief & { bed: BedBrief | null })[]; beds: (BedBrief & { patient: PatientBrief | null })[] }>(
      "/search",
      { q },
    ),
};
