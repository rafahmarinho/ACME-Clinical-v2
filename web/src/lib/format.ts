import { format, formatDistanceToNowStrict, parseISO } from "date-fns";
import type { Param, Priority, Scenario } from "../types";

export const PARAM_META: Record<Param | "map", { label: string; short: string; unit: string; color: string; text: string }> = {
  hr: { label: "Heart rate", short: "HR", unit: "bpm", color: "#059669", text: "text-hr" },
  spo2: { label: "Oxygen saturation", short: "SpO₂", unit: "%", color: "#0369a1", text: "text-spo2" },
  rr: { label: "Respiratory rate", short: "RR", unit: "rpm", color: "#b45309", text: "text-rr" },
  sbp: { label: "Systolic BP", short: "SYS", unit: "mmHg", color: "#be185d", text: "text-bp" },
  dbp: { label: "Diastolic BP", short: "DIA", unit: "mmHg", color: "#db2777", text: "text-bp" },
  map: { label: "Mean arterial pressure", short: "MAP", unit: "mmHg", color: "#9d174d", text: "text-bp" },
};

export const PARAMS: Param[] = ["hr", "spo2", "rr", "sbp", "dbp"];

export const SCENARIO_LABEL: Record<Scenario, string> = {
  normal: "Normal readings",
  low_spo2: "Low oxygen saturation",
  low_battery: "Low battery",
  sensor_fault: "Sensor problem",
  connection_loss: "Connection loss",
};

export const PRIORITY_STYLE: Record<Priority, { label: string; chip: string; dot: string; border: string }> = {
  high: { label: "High", chip: "bg-red-50 text-red-700 ring-red-200", dot: "bg-alarm-high", border: "border-alarm-high" },
  medium: { label: "Medium", chip: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-alarm-medium", border: "border-alarm-medium" },
  low: { label: "Low", chip: "bg-cyan-50 text-cyan-800 ring-cyan-200", dot: "bg-alarm-low", border: "border-alarm-low" },
};

export const ALARM_TYPE_LABEL: Record<string, string> = {
  spo2_low: "SpO₂ low", spo2_high: "SpO₂ high", hr_low: "Bradycardia", hr_high: "Tachycardia", rr_low: "Resp. rate low",
  rr_high: "Resp. rate high", sbp_low: "Hypotension", sbp_high: "Hypertension", dbp_low: "Diastolic low", dbp_high: "Diastolic high",
  battery_low: "Battery low", sensor_fault: "Sensor problem", connection_lost: "Connection lost",
};

export const fmtNum = (v: number | null | undefined, digits = 0) => (v === null || v === undefined ? "--" : v.toFixed(digits));
export const fmtTime = (iso?: string | null) => (iso ? format(parseISO(iso), "HH:mm:ss") : "—");
export const fmtDateTime = (iso?: string | null) => (iso ? format(parseISO(iso), "MMM d, yyyy HH:mm") : "—");
export const fmtDate = (iso?: string | null) => (iso ? format(parseISO(iso), "MMM d, yyyy") : "—");
export const ago = (iso?: string | null) => (iso ? `${formatDistanceToNowStrict(parseISO(iso))} ago` : "—");
export const duration = (fromIso: string, toIso?: string | null) => {
  const s = Math.max(0, Math.round(((toIso ? parseISO(toIso) : new Date()).getTime() - parseISO(fromIso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};
export const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
