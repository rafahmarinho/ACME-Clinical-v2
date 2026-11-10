export type Role = "nurse" | "physician" | "biomed" | "admin";
export type Priority = "high" | "medium" | "low";
export type Scenario = "normal" | "low_spo2" | "low_battery" | "sensor_fault" | "connection_loss";
export type Param = "hr" | "spo2" | "rr" | "sbp" | "dbp";

export interface Preferences {
  alarm_sound: boolean;
  alarm_volume: number;
  default_ward_id: string | null;
  trend_window_minutes: number;
  show_ecg: boolean;
  compact_tiles: boolean;
  notify_high_priority: boolean;
  notify_technical: boolean;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  title: string | null;
  phone: string | null;
  avatar_url: string | null;
  is_active: boolean;
  preferences: Preferences;
  created_at: string;
}

export interface BedBrief {
  id: string;
  label: string;
  ward_id: string;
  ward_code: string;
  ward_name: string;
}

export interface PatientBrief {
  id: string;
  mrn: string;
  first_name: string;
  last_name: string;
  full_name: string;
  age: number;
  sex: string;
  acuity: "low" | "moderate" | "high" | "critical";
  diagnosis: string;
  code_status: string;
}

export interface MonitorBrief {
  id: string;
  asset_tag: string;
  serial_number: string;
  model: string;
  status: "in_use" | "available" | "maintenance" | "retired";
  connection: "online" | "offline";
  sensor_status: "ok" | "fault";
  battery_level: number;
  scenario: Scenario;
  last_seen_at: string | null;
  bed_id: string | null;
}

export interface Vitals {
  hr: number | null;
  spo2: number | null;
  rr: number | null;
  sbp: number | null;
  dbp: number | null;
  map: number | null;
  battery_level: number | null;
  signal_quality: "good" | "sensor_fault" | "no_signal" | string;
  recorded_at: string;
  tick: number;
  ecg?: number[];
  ecg_sample_rate?: number;
  patient_id?: string | null;
}

export interface AlarmSummary {
  count: number;
  unacknowledged: number;
  highest: Priority | null;
  items: { id: string; type: string; priority: Priority; message: string; acknowledged: boolean; kind: string }[];
}

export interface PatientRow extends PatientBrief {
  status: string;
  admitted_at: string;
  attending_physician: string | null;
  allergies: string[];
  date_of_birth: string;
  bed: BedBrief | null;
  monitor: MonitorBrief | null;
  vitals: Vitals | null;
  alarms: AlarmSummary;
}

export interface Limit {
  low: number | null;
  high: number | null;
  enabled: boolean;
  custom?: boolean;
}

export interface PatientDetail extends PatientRow {
  baseline: Record<Param, number>;
  limits: Record<Param, Limit>;
}

export interface WardBed {
  id: string;
  label: string;
  pos_x: number;
  pos_z: number;
  patient: PatientBrief | null;
  monitor: MonitorBrief | null;
  vitals: Vitals | null;
  alarms: AlarmSummary;
}

export interface Ward {
  id: string;
  code: string;
  name: string;
  floor: string | null;
  description: string | null;
  beds: WardBed[];
  stats: { beds: number; occupied: number; monitored: number; active_alarms: number; unacknowledged: number; high_priority: number };
}

export interface LiveTile {
  bed: BedBrief;
  monitor: MonitorBrief;
  patient: PatientBrief | null;
  vitals: Vitals | null;
  alarms: AlarmSummary;
}

export interface Alarm {
  id: string;
  monitor_id: string | null;
  patient_id: string | null;
  bed_id: string | null;
  kind: "physiological" | "technical";
  type: string;
  priority: Priority;
  message: string;
  value: number | null;
  threshold: number | null;
  state: "active" | "cleared";
  started_at: string;
  last_seen_at: string;
  cleared_at: string | null;
  acknowledged_at: string | null;
  acknowledged_by_name: string | null;
  ack_note: string | null;
  bed?: BedBrief | null;
  patient?: PatientBrief | null;
  monitor?: { id: string; asset_tag: string } | null;
}

export interface AlarmCounts {
  active: number;
  unacknowledged: number;
  high: number;
  high_unacknowledged: number;
  technical: number;
}

export interface Observation {
  id: string;
  patient_id: string;
  author_name: string;
  author_role: Role | null;
  category: "assessment" | "intervention" | "medication" | "note" | "escalation";
  note: string;
  vitals: Partial<Vitals> | null;
  created_at: string;
}

export interface TrendPoint {
  recorded_at: string;
  hr: number | null;
  spo2: number | null;
  rr: number | null;
  sbp: number | null;
  dbp: number | null;
  map: number | null;
}

export interface Monitor extends MonitorBrief {
  manufacturer: string;
  firmware: string;
  last_maintenance_at: string | null;
  next_maintenance_due: string | null;
  bed: BedBrief | null;
  patient: PatientBrief | null;
  open_work_orders?: number;
  maintenance_overdue?: boolean;
  technical_alarms?: { type: string; priority: Priority; message: string }[];
}

export interface MaintenanceRecord {
  id: string;
  monitor_id: string;
  type: "preventive" | "corrective" | "calibration" | "battery_replacement" | "inspection";
  status: "scheduled" | "in_progress" | "completed" | "cancelled";
  scheduled_for: string;
  completed_at: string | null;
  technician_name: string | null;
  description: string;
  resolution: string | null;
  attachment_path: string | null;
  created_at: string;
  monitor?: { id: string; asset_tag: string; model: string; serial_number: string };
}

export interface MonitorDetail extends Omit<Monitor, "technical_alarms"> {
  state: Vitals | null;
  maintenance: MaintenanceRecord[];
  technical_alarms: Alarm[];
  events: EventRow[];
}

export interface EventRow {
  id: number;
  occurred_at: string;
  tick: number | null;
  source: "simulation" | "user" | "system" | "integration";
  type: string;
  severity: "info" | "warning" | "critical";
  message: string;
  monitor_id: string | null;
  patient_id: string | null;
  actor_name: string | null;
}

export interface Threshold {
  id: string;
  patient_id: string | null;
  parameter: Param;
  low: number | null;
  high: number | null;
  enabled: boolean;
  updated_at: string;
}

export interface ThresholdOverview {
  defaults: Threshold[];
  patients: { patient_id: string; patient_name: string; mrn: string; bed: string | null; limits: Threshold[] }[];
}

export interface Report {
  id: string;
  type: "alarm_summary" | "patient_vitals" | "device_status";
  title: string;
  params: { hours?: number; ward_id?: string | null; patient_id?: string | null };
  summary: Record<string, unknown>;
  created_by_name: string | null;
  created_at: string;
}

export interface SimState {
  tick: number;
  sim_time: string;
  running: boolean;
  tick_seconds: number;
  last_advanced_at: string | null;
}

export interface SimulationOverview {
  state: SimState;
  scenarios: { id: Scenario; label: string }[];
  monitors: (MonitorBrief & { bed: BedBrief | null; patient: PatientBrief | null; simulated: boolean })[];
}

export interface StaffMember {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  title: string | null;
  phone: string | null;
  avatar_url: string | null;
  is_active: boolean;
  created_at: string;
}

export interface SystemSettings {
  facility_name: string;
  paging_enabled: boolean;
  escalation_minutes: number;
  battery_low_threshold: number;
  history_retention_hours: number;
}

export interface IntegrationMessage {
  id: number;
  channel: "pager" | "sms" | "email" | "ehr";
  recipient: string;
  subject: string;
  body: string;
  status: string;
  created_at: string;
}
