import clsx from "clsx";
import { BatteryLow, BatteryMedium, BatteryFull, WifiOff, Unplug } from "lucide-react";
import { fmtNum, PARAM_META, PRIORITY_STYLE, ALARM_TYPE_LABEL } from "../../lib/format";
import type { AlarmSummary, Limit, MonitorBrief, Param, Priority, Vitals } from "../../types";

export function VitalValue({
  param,
  value,
  size = "lg",
  alarm,
  limit,
  stale,
}: {
  param: Param;
  value: number | null | undefined;
  size?: "sm" | "md" | "lg" | "xl";
  alarm?: Priority | null;
  limit?: Limit;
  stale?: boolean;
}) {
  const m = PARAM_META[param];
  const sizes = { sm: "text-2xl", md: "text-4xl", lg: "text-5xl", xl: "text-7xl" };
  return (
    <div className={clsx("min-w-0 rounded-lg px-1", alarm && "bg-red-50 ring-2", alarm === "high" ? "ring-alarm-high" : alarm ? "ring-alarm-medium" : "")}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={clsx("text-xs font-bold uppercase tracking-wide", m.text)}>{m.short}</span>
        {limit && limit.enabled && (
          <span className="tabular text-[10px] font-medium text-navy-400">
            {limit.low ?? "–"}/{limit.high ?? "–"}
          </span>
        )}
      </div>
      <div className={clsx("tabular font-extrabold leading-none", sizes[size], stale ? "text-slate-300" : m.text)}>
        {fmtNum(value)}
      </div>
      <div className="text-[11px] font-medium text-navy-400">{m.unit}</div>
    </div>
  );
}

export function BloodPressure({ v, size = "lg", alarm, stale }: { v: Vitals | null; size?: "sm" | "md" | "lg" | "xl"; alarm?: Priority | null; stale?: boolean }) {
  const sizes = { sm: "text-2xl", md: "text-4xl", lg: "text-5xl", xl: "text-6xl" };
  return (
    <div className={clsx("min-w-0 rounded-lg px-1", alarm && "bg-red-50 ring-2 ring-alarm-medium")}>
      <span className="text-xs font-bold uppercase tracking-wide text-bp">NIBP</span>
      <div className={clsx("tabular whitespace-nowrap font-extrabold leading-none", sizes[size], stale ? "text-slate-300" : "text-bp")}>
        {fmtNum(v?.sbp)}
        <span className="text-[0.6em] font-bold">/{fmtNum(v?.dbp)}</span>
      </div>
      <div className="text-[11px] font-medium text-navy-400">
        mmHg · MAP <span className="tabular font-semibold">{fmtNum(v?.map)}</span>
      </div>
    </div>
  );
}

export function BatteryIndicator({ level, className }: { level: number | null | undefined; className?: string }) {
  const l = level ?? 0;
  const Icon = l < 20 ? BatteryLow : l < 60 ? BatteryMedium : BatteryFull;
  return (
    <span className={clsx("tabular inline-flex items-center gap-1 text-xs font-semibold", l < 20 ? "text-red-600" : "text-navy-500", className)}>
      <Icon className="size-4" />
      {Math.round(l)}%
    </span>
  );
}

export function DeviceStatus({ monitor }: { monitor: MonitorBrief | null }) {
  if (!monitor) return <span className="text-xs text-navy-400">No monitor</span>;
  return (
    <span className="inline-flex items-center gap-2">
      {monitor.connection === "offline" ? (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600">
          <WifiOff className="size-3.5" /> Offline
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
          <span className="pulse-dot size-2 rounded-full bg-emerald-500" /> Online
        </span>
      )}
      {monitor.sensor_status === "fault" && (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
          <Unplug className="size-3.5" /> Sensor
        </span>
      )}
      <BatteryIndicator level={monitor.battery_level} />
    </span>
  );
}

export function PriorityChip({ priority, children }: { priority: Priority; children?: React.ReactNode }) {
  const s = PRIORITY_STYLE[priority];
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-bold ring-1 ring-inset", s.chip)}>
      <span className={clsx("size-1.5 rounded-full", s.dot)} />
      {children ?? s.label}
    </span>
  );
}

export function AlarmPills({ alarms, max = 3 }: { alarms: AlarmSummary; max?: number }) {
  if (!alarms.count) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {alarms.items.slice(0, max).map((a) => (
        <PriorityChip key={a.id} priority={a.priority}>
          {ALARM_TYPE_LABEL[a.type] ?? a.type}
          {a.acknowledged && <span className="font-medium opacity-70">· ack</span>}
        </PriorityChip>
      ))}
      {alarms.count > max && <span className="text-xs font-semibold text-navy-500">+{alarms.count - max}</span>}
    </div>
  );
}

/** Which vitals are currently in alarm (from active alarm types like "spo2_low"). */
export function alarmByParam(alarms: AlarmSummary | undefined): Partial<Record<Param, Priority>> {
  const out: Partial<Record<Param, Priority>> = {};
  alarms?.items.forEach((a) => {
    const p = a.type.split("_")[0] as Param;
    if (a.kind === "physiological" && ["hr", "spo2", "rr", "sbp", "dbp"].includes(p)) out[p] = a.priority;
  });
  return out;
}
