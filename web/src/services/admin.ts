import { api } from "../lib/api";
import type {
  EventRow, IntegrationMessage, Param, Preferences, Profile, Report, Scenario, SimulationOverview, StaffMember, SystemSettings,
  ThresholdOverview, Threshold,
} from "../types";

export interface LimitInput {
  parameter: Param;
  low: number | null;
  high: number | null;
  enabled: boolean;
}

export const profileService = {
  me: () => api.get<Profile>("/me"),
  update: (body: Partial<Pick<Profile, "full_name" | "title" | "phone" | "avatar_url">>) => api.patch<Profile>("/me", body),
  savePreferences: (p: Preferences) => api.put<Preferences>("/me/preferences", p),
  systemSettings: () => api.get<SystemSettings>("/settings/system"),
  saveSystemSettings: (s: SystemSettings) => api.put<SystemSettings>("/settings/system", s),
};

export const thresholdService = {
  list: () => api.get<ThresholdOverview>("/thresholds"),
  setDefaults: (items: LimitInput[]) => api.put<Threshold[]>("/thresholds/defaults", { items }),
  setPatient: (patientId: string, items: LimitInput[]) => api.put<Threshold[]>(`/thresholds/patients/${patientId}`, { items }),
  resetPatient: (patientId: string, parameter: Param) => api.del<void>(`/thresholds/patients/${patientId}/${parameter}`),
};

export const reportService = {
  list: () => api.get<Report[]>("/reports"),
  create: (body: { type: Report["type"]; hours: number; ward_id?: string | null; patient_id?: string | null }) =>
    api.post<Report>("/reports", body),
  download: (id: string, format: "csv" | "pdf") => api.get<{ url: string }>(`/reports/${id}/download`, { format }),
};

export const teamService = {
  list: (f: { q?: string; role?: string; active?: boolean } = {}) => api.get<StaffMember[]>("/team", { ...f }),
  create: (body: { email: string; full_name: string; role: string; title?: string; password: string }) => api.post<StaffMember>("/team", body),
  update: (id: string, body: Partial<{ role: string; is_active: boolean; full_name: string; title: string }>) =>
    api.patch<StaffMember>(`/team/${id}`, body),
};

export const simulationService = {
  overview: () => api.get<SimulationOverview>("/simulation"),
  advance: (ticks: number) =>
    api.post<{ ticks: number; readings: number; alarms_raised: number; alarms_cleared: number }>("/simulation/advance", { ticks }),
  tick: () => api.post<{ skipped: boolean }>("/simulation/tick"),
  setRunning: (running: boolean) => api.put("/simulation/running", { running }),
  setScenario: (monitorId: string, scenario: Scenario) => api.put(`/simulation/monitors/${monitorId}/scenario`, { scenario }),
  setBulk: (monitor_ids: string[], scenario: Scenario) => api.post("/simulation/scenario", { monitor_ids, scenario }),
  reset: () => api.post<Record<string, number>>("/simulation/reset"),
  events: (f: { source?: string; severity?: string; type?: string; q?: string; monitor_id?: string; patient_id?: string; before?: number; limit?: number } = {}) =>
    api.get<EventRow[]>("/events", { ...f }),
  messages: (channel?: string) => api.get<IntegrationMessage[]>("/integrations/messages", { channel }),
};
