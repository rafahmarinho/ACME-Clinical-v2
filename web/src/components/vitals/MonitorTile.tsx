import clsx from "clsx";
import { Link } from "react-router";
import { ago } from "../../lib/format";
import type { LiveTile } from "../../types";
import { EcgCanvas } from "./EcgCanvas";
import { AlarmPills, BloodPressure, DeviceStatus, VitalValue, alarmByParam } from "./Vitals";

export function MonitorTile({ tile, showEcg = true, compact = false }: { tile: LiveTile; showEcg?: boolean; compact?: boolean }) {
  const v = tile.vitals;
  const offline = tile.monitor.connection === "offline";
  const stale = offline || !v;
  const byParam = alarmByParam(tile.alarms);
  const high = tile.alarms.items.some((a) => a.priority === "high" && !a.acknowledged);
  const border =
    tile.alarms.highest === "high" ? "border-alarm-high" : tile.alarms.highest === "medium" ? "border-alarm-medium" : tile.alarms.highest === "low" ? "border-alarm-low" : "border-navy-100";

  const body = (
    <div className={clsx("flex h-full flex-col rounded-xl border-2 bg-white p-4 transition-shadow hover:shadow-md", border, high && "alarm-flash")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-navy-900 px-2 py-0.5 text-sm font-bold text-white">{tile.bed.label}</span>
            <span className="truncate font-semibold text-navy-900">{tile.patient ? tile.patient.full_name : "Empty bed"}</span>
          </div>
          <div className="mt-0.5 truncate text-xs text-navy-500">
            {tile.patient ? `${tile.patient.age}y · ${tile.patient.sex === "female" ? "F" : tile.patient.sex === "male" ? "M" : "X"} · ${tile.patient.diagnosis}` : tile.monitor.asset_tag}
          </div>
        </div>
        <DeviceStatus monitor={tile.monitor} />
      </div>

      {showEcg && (
        <div className="mt-2 rounded-md bg-navy-50/40">
          <div className="flex justify-between px-1 pt-1 text-[10px] font-bold tracking-wide text-hr">
            <span>II</span>
            <span>25 mm/s</span>
          </div>
          <EcgCanvas samples={v?.ecg} sampleRate={v?.ecg_sample_rate ?? 125} disconnected={offline} height={compact ? 48 : 64} />
        </div>
      )}

      <div className={clsx("mt-3 grid gap-3", compact ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-4")}>
        <VitalValue param="hr" value={v?.hr} size={compact ? "sm" : "md"} alarm={byParam.hr} stale={stale} />
        <VitalValue param="spo2" value={v?.spo2} size={compact ? "sm" : "md"} alarm={byParam.spo2} stale={stale || v?.spo2 == null} />
        <VitalValue param="rr" value={v?.rr} size={compact ? "sm" : "md"} alarm={byParam.rr} stale={stale} />
        {!compact && <BloodPressure v={v} size="sm" alarm={byParam.sbp ?? byParam.dbp} stale={stale} />}
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-3">
        <AlarmPills alarms={tile.alarms} />
        <span className="ml-auto text-[11px] text-navy-400">
          {offline ? `Last data ${ago(v?.recorded_at ?? tile.monitor.last_seen_at)}` : v?.signal_quality === "sensor_fault" ? "SpO₂ probe fault" : tile.monitor.asset_tag}
        </span>
      </div>
    </div>
  );
  return tile.patient ? (
    <Link to={`/patients/${tile.patient.id}`} className="focus-ring block rounded-xl">
      {body}
    </Link>
  ) : (
    body
  );
}
