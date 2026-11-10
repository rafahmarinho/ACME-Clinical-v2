import {
  Activity, BellRing, Building2, FileBarChart, FlaskConical, MonitorSmartphone, SlidersHorizontal, Users, UsersRound, Wrench,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "../types";

export const ROLE_LABEL: Record<Role, string> = {
  nurse: "Nurse",
  physician: "Physician",
  biomed: "Biomedical Technician",
  admin: "Administrator",
};

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
  section: "Clinical" | "Devices" | "Administration";
}

const ALL: Role[] = ["nurse", "physician", "biomed", "admin"];

export const NAV: NavItem[] = [
  { to: "/wards", label: "Ward Overview", icon: Building2, roles: ["nurse", "physician", "admin", "biomed"], section: "Clinical" },
  { to: "/patients", label: "Patients", icon: UsersRound, roles: ["nurse", "physician", "admin"], section: "Clinical" },
  { to: "/monitoring", label: "Live Monitoring", icon: Activity, roles: ALL, section: "Clinical" },
  { to: "/alarms", label: "Alarms", icon: BellRing, roles: ALL, section: "Clinical" },
  { to: "/thresholds", label: "Alarm Limits", icon: SlidersHorizontal, roles: ["nurse", "physician", "admin"], section: "Clinical" },
  { to: "/devices", label: "Devices", icon: MonitorSmartphone, roles: ["nurse", "biomed", "admin"], section: "Devices" },
  { to: "/maintenance", label: "Maintenance", icon: Wrench, roles: ["biomed", "admin"], section: "Devices" },
  { to: "/reports", label: "Reports", icon: FileBarChart, roles: ["physician", "biomed", "admin"], section: "Administration" },
  { to: "/team", label: "Team", icon: Users, roles: ["admin"], section: "Administration" },
  { to: "/simulation", label: "Simulation Lab", icon: FlaskConical, roles: ["biomed", "admin"], section: "Administration" },
];

export const HOME: Record<Role, string> = {
  nurse: "/wards",
  physician: "/patients",
  biomed: "/devices",
  admin: "/wards",
};

export const can = {
  acknowledge: (r?: Role) => !!r,
  editLimits: (r?: Role) => r === "physician" || r === "admin",
  bindMonitor: (r?: Role) => r === "nurse" || r === "biomed" || r === "admin",
  manageDevices: (r?: Role) => r === "biomed" || r === "admin",
  writeObservation: (r?: Role) => r === "nurse" || r === "physician" || r === "admin",
  runSimulation: (r?: Role) => r === "biomed" || r === "admin",
  admin: (r?: Role) => r === "admin",
  reports: (r?: Role) => r === "physician" || r === "biomed" || r === "admin",
};

export function allowed(path: string, role?: Role) {
  const item = NAV.find((n) => path === n.to || path.startsWith(n.to + "/"));
  return !item || (!!role && item.roles.includes(role));
}
