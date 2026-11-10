import { api } from "../lib/api";
import type { MaintenanceRecord, Monitor, MonitorDetail } from "../types";

export const deviceService = {
  list: (f: { q?: string; status?: string; model?: string; connection?: string } = {}) => api.get<Monitor[]>("/monitors", { ...f }),
  get: (id: string) => api.get<MonitorDetail>(`/monitors/${id}`),
  bind: (id: string, bed_id: string | null) => api.post<Monitor>(`/monitors/${id}/bind`, { bed_id }),
  update: (id: string, body: Partial<{ status: string; firmware: string; next_maintenance_due: string }>) =>
    api.patch<Monitor>(`/monitors/${id}`, body),
  maintenance: (f: { status?: string; type?: string; monitor_id?: string } = {}) => api.get<MaintenanceRecord[]>("/maintenance", { ...f }),
  createMaintenance: (body: { monitor_id: string; type: string; scheduled_for: string; description: string }) =>
    api.post<MaintenanceRecord>("/maintenance", body),
  updateMaintenance: (id: string, body: Partial<{ status: string; resolution: string; scheduled_for: string }>) =>
    api.patch<MaintenanceRecord>(`/maintenance/${id}`, body),
  uploadAttachment: (id: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.upload<MaintenanceRecord>(`/maintenance/${id}/attachment`, fd);
  },
  attachmentUrl: (id: string) => api.get<{ url: string }>(`/maintenance/${id}/attachment`),
};
