import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ClipboardPlus, Link2, MonitorSmartphone, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { AckAlarmDialog, BindMonitorDialog } from "../components/Dialogs";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, PageLoader, Select, Tabs, Textarea } from "../components/ui";
import { EcgCanvas } from "../components/vitals/EcgCanvas";
import { TrendChart } from "../components/vitals/TrendChart";
import { BloodPressure, DeviceStatus, PriorityChip, VitalValue, alarmByParam } from "../components/vitals/Vitals";
import { useAuth } from "../context/AuthContext";
import { errorMessage } from "../lib/api";
import { ALARM_TYPE_LABEL, ago, duration, fmtDate, fmtDateTime, fmtNum, PARAM_META, titleCase } from "../lib/format";
import { can } from "../lib/roles";
import { alarmService } from "../services/alarms";
import { clinicalService } from "../services/clinical";
import { deviceService } from "../services/devices";
import type { Alarm, MonitorBrief, Observation } from "../types";

const CATEGORIES: Observation["category"][] = ["assessment", "intervention", "medication", "note", "escalation"];

function ObservationForm({ patientId }: { patientId: string }) {
  const qc = useQueryClient();
  const [category, setCategory] = useState<Observation["category"]>("assessment");
  const [note, setNote] = useState("");
  const m = useMutation({
    mutationFn: () => clinicalService.addObservation(patientId, { category, note, include_vitals: true }),
    onSuccess: () => {
      toast.success("Observation recorded (vitals snapshot attached, sent to EHR)");
      setNote("");
      qc.invalidateQueries({ queryKey: ["observations", patientId] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <form
      className="space-y-3 border-b border-navy-100 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (note.trim().length < 3) return toast.error("Write at least a few words.");
        m.mutate();
      }}
    >
      <div className="flex gap-2">
        <Select value={category} onChange={(e) => setCategory(e.target.value as Observation["category"])} className="w-44" aria-label="Category">
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {titleCase(c)}
            </option>
          ))}
        </Select>
      </div>
      <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Clinical observation…" maxLength={4000} aria-label="Observation" />
      <div className="flex justify-end">
        <Button type="submit" loading={m.isPending} icon={<ClipboardPlus className="size-4" />}>
          Record observation
        </Button>
      </div>
    </form>
  );
}

export default function PatientDetailPage() {
  const { id = "" } = useParams();
  const { profile } = useAuth();
  const [minutes, setMinutes] = useState<string>(String(profile?.preferences.trend_window_minutes ?? 30));
  const [ack, setAck] = useState<Alarm | null>(null);
  const [bindTarget, setBindTarget] = useState<MonitorBrief | null>(null);
  const [pickMonitor, setPickMonitor] = useState(false);
  const p = useQuery({ queryKey: ["patient", id], queryFn: () => clinicalService.patient(id) });
  const trend = useQuery({ queryKey: ["vitals", id, minutes], queryFn: () => clinicalService.vitals(id, Number(minutes)), refetchInterval: 20_000 });
  const obs = useQuery({ queryKey: ["observations", id], queryFn: () => clinicalService.observations(id) });
  const alarms = useQuery({ queryKey: ["patient-alarms", id], queryFn: () => alarmService.forPatient(id) });
  const spare = useQuery({ queryKey: ["monitors", "available"], queryFn: () => deviceService.list({ status: "available" }), enabled: pickMonitor });

  if (p.isLoading) return <PageLoader label="Loading patient…" />;
  if (p.error) return <ErrorState error={p.error} onRetry={() => p.refetch()} />;
  const pt = p.data!;
  const v = pt.vitals;
  const offline = pt.monitor?.connection === "offline";
  const byParam = alarmByParam(pt.alarms);
  const activeAlarms = (alarms.data ?? []).filter((a) => a.state === "active");
  const pastAlarms = (alarms.data ?? []).filter((a) => a.state !== "active");

  return (
    <div>
      <Link to="/patients" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-navy-600 hover:underline">
        <ArrowLeft className="size-4" /> Patients
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            {pt.bed && <span className="rounded-lg bg-navy-900 px-3 py-1 text-lg font-bold text-white">{pt.bed.label}</span>}
            <h1 className="text-3xl font-bold tracking-tight">{pt.full_name}</h1>
            <Badge tone={pt.acuity === "critical" ? "red" : pt.acuity === "high" ? "amber" : "navy"}>{pt.acuity} acuity</Badge>
            <Badge tone="gray">{pt.code_status}</Badge>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-navy-600">
            <span>{pt.mrn}</span>
            <span>
              {pt.age} years · {titleCase(pt.sex)} · DOB {fmtDate(pt.date_of_birth)}
            </span>
            <span>Admitted {fmtDateTime(pt.admitted_at)}</span>
            <span>Attending: {pt.attending_physician ?? "—"}</span>
          </div>
          <div className="mt-1 text-sm">
            <span className="font-semibold">{pt.diagnosis}</span>
            {pt.allergies.length > 0 && <span className="ml-3 font-semibold text-red-700">Allergies: {pt.allergies.join(", ")}</span>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {pt.monitor ? (
            <>
              <DeviceStatus monitor={pt.monitor} />
              <div className="text-xs text-navy-500">
                <Link to={`/devices/${pt.monitor.id}`} className="font-semibold hover:underline">{pt.monitor.asset_tag}</Link> · {pt.monitor.model}
              </div>
              {can.bindMonitor(profile?.role) && (
                <Button size="sm" variant="secondary" onClick={() => setBindTarget(pt.monitor)}>
                  Unlink monitor
                </Button>
              )}
            </>
          ) : (
            can.bindMonitor(profile?.role) && pt.bed && (
              <Button icon={<Link2 className="size-4" />} onClick={() => setPickMonitor(true)}>
                Link a monitor
              </Button>
            )
          )}
        </div>
      </div>

      {pickMonitor && !pt.monitor && (
        <Card className="mb-6 p-4">
          <div className="mb-2 text-sm font-semibold">Available monitors</div>
          {spare.isLoading ? (
            <div className="text-sm text-navy-500">Loading…</div>
          ) : !spare.data?.length ? (
            <div className="text-sm text-navy-500">No monitors are available. Unlink one or finish maintenance first.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {spare.data.map((m) => (
                <Button
                  key={m.id}
                  variant="secondary"
                  icon={<MonitorSmartphone className="size-4" />}
                  onClick={async () => {
                    try {
                      await deviceService.bind(m.id, pt.bed!.id);
                      toast.success(`${m.asset_tag} linked to ${pt.bed!.label}`);
                      setPickMonitor(false);
                      p.refetch();
                    } catch (e) {
                      toast.error(errorMessage(e));
                    }
                  }}
                >
                  {m.asset_tag} · {m.model}
                </Button>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Live vitals */}
      <Card className="mb-6 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Live vital signs</h2>
          <span className="text-xs text-navy-500">
            {!pt.monitor ? "No monitor linked" : offline ? `Connection lost · last data ${ago(v?.recorded_at)}` : v ? `Updated ${ago(v.recorded_at)}` : "Waiting for first reading"}
          </span>
        </div>
        {pt.monitor ? (
          <>
            {profile?.preferences.show_ecg !== false && (
              <div className="mb-4 rounded-lg bg-navy-50/40 p-2">
                <div className="flex justify-between px-1 text-[11px] font-bold text-hr">
                  <span>ECG · Lead II</span>
                  <span>25 mm/s · 10 mm/mV</span>
                </div>
                <EcgCanvas samples={v?.ecg} sampleRate={v?.ecg_sample_rate ?? 125} height={110} disconnected={offline} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
              <VitalValue param="hr" value={v?.hr} size="xl" alarm={byParam.hr} limit={pt.limits.hr} stale={offline} />
              <VitalValue param="spo2" value={v?.spo2} size="xl" alarm={byParam.spo2} limit={pt.limits.spo2} stale={offline || v?.spo2 == null} />
              <VitalValue param="rr" value={v?.rr} size="xl" alarm={byParam.rr} limit={pt.limits.rr} stale={offline} />
              <BloodPressure v={v} size="xl" alarm={byParam.sbp ?? byParam.dbp} stale={offline} />
            </div>
            {v?.signal_quality === "sensor_fault" && <div className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">SpO₂ probe reports an invalid signal — check sensor placement.</div>}
          </>
        ) : (
          <EmptyState title="This patient is not being monitored" description="Link an available monitor to this bed to start receiving vital signs." />
        )}
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Trends"
              subtitle="Dashed lines show the alarm limits in effect"
              action={
                <Tabs value={minutes} onChange={setMinutes} items={["15", "30", "60", "120"].map((m) => ({ value: m, label: `${m}m` }))} />
              }
            />
            <div className="grid gap-4 p-4 md:grid-cols-2">
              {trend.error ? (
                <ErrorState error={trend.error} onRetry={() => trend.refetch()} />
              ) : !trend.data?.length ? (
                <div className="col-span-2 py-10 text-center text-sm text-navy-500">{trend.isLoading ? "Loading trends…" : "No readings in this window."}</div>
              ) : (
                (["hr", "spo2", "rr", "sbp"] as const).map((prm) => (
                  <div key={prm}>
                    <div className="mb-1 flex justify-between text-xs font-bold">
                      <span style={{ color: PARAM_META[prm].color }}>{prm === "sbp" ? "Blood pressure (SYS/DIA)" : PARAM_META[prm].label}</span>
                      <span className="text-navy-400">{PARAM_META[prm].unit}</span>
                    </div>
                    <TrendChart data={trend.data} params={prm === "sbp" ? ["sbp", "dbp"] : [prm]} limits={pt.limits} height={150} />
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Alarms" subtitle="Acknowledged alarms stay active until the condition resolves" />
            <div className="divide-y divide-navy-50">
              {[...activeAlarms, ...pastAlarms.slice(0, 12)].map((a) => (
                <div key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <PriorityChip priority={a.priority}>{ALARM_TYPE_LABEL[a.type] ?? a.type}</PriorityChip>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{a.message}</div>
                    <div className="text-xs text-navy-500">
                      {fmtDateTime(a.started_at)} · {a.state === "active" ? `active ${duration(a.started_at)}` : `lasted ${duration(a.started_at, a.cleared_at)}`}
                      {a.acknowledged_by_name && ` · ack by ${a.acknowledged_by_name}`}
                      {a.ack_note && ` — “${a.ack_note}”`}
                    </div>
                  </div>
                  {a.state === "active" ? <Badge tone="red">Active</Badge> : <Badge tone="gray">Resolved</Badge>}
                  {!a.acknowledged_at && (
                    <Button size="sm" onClick={() => setAck({ ...a, bed: pt.bed, patient: pt })}>
                      Acknowledge
                    </Button>
                  )}
                </div>
              ))}
              {!alarms.data?.length && <div className="px-5 py-8 text-center text-sm text-navy-500">No alarms recorded for this patient.</div>}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Alarm limits"
              action={
                can.editLimits(profile?.role) && (
                  <Link to={`/thresholds?patient=${pt.id}`}>
                    <Button size="sm" variant="secondary" icon={<SlidersHorizontal className="size-4" />}>
                      Adjust
                    </Button>
                  </Link>
                )
              }
            />
            <div className="divide-y divide-navy-50">
              {(["hr", "spo2", "rr", "sbp", "dbp"] as const).map((prm) => {
                const l = pt.limits[prm];
                return (
                  <div key={prm} className="flex items-center justify-between px-5 py-2.5 text-sm">
                    <span className="font-semibold" style={{ color: PARAM_META[prm].color }}>
                      {PARAM_META[prm].label}
                    </span>
                    <span className="tabular font-semibold">
                      {l.enabled ? `${fmtNum(l.low)} – ${fmtNum(l.high)} ${PARAM_META[prm].unit}` : "Off"}
                      {l.custom && <Badge tone="cyan" className="ml-2">custom</Badge>}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card>
            <CardHeader title="Observations" subtitle="Bedside documentation" />
            {can.writeObservation(profile?.role) && <ObservationForm patientId={pt.id} />}
            <div className="max-h-[560px] divide-y divide-navy-50 overflow-y-auto">
              {obs.isLoading && <div className="p-5 text-sm text-navy-500">Loading…</div>}
              {obs.data?.map((o) => (
                <div key={o.id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <Badge tone="navy">{titleCase(o.category)}</Badge>
                    <span className="text-xs text-navy-400">{fmtDateTime(o.created_at)}</span>
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm text-navy-800">{o.note}</p>
                  <div className="mt-1 text-xs text-navy-500">
                    {o.author_name}
                    {o.vitals && (
                      <span className="tabular ml-2 text-navy-400">
                        · HR {fmtNum(o.vitals.hr)} · SpO₂ {fmtNum(o.vitals.spo2)} · RR {fmtNum(o.vitals.rr)} · BP {fmtNum(o.vitals.sbp)}/{fmtNum(o.vitals.dbp)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {obs.data && !obs.data.length && <div className="p-5 text-center text-sm text-navy-500">No observations yet.</div>}
            </div>
          </Card>
        </div>
      </div>
      <AckAlarmDialog alarm={ack} onClose={() => setAck(null)} />
      <BindMonitorDialog monitor={bindTarget} onClose={() => { setBindTarget(null); p.refetch(); }} />
    </div>
  );
}
