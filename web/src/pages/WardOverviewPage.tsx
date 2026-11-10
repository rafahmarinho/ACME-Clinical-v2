import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { BedDouble, Box, BellRing, LayoutGrid, MonitorSmartphone, UsersRound } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { Link } from "react-router";
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, PageLoader, Skeleton, StatCard, Tabs } from "../components/ui";
import { AlarmPills, DeviceStatus, alarmByParam } from "../components/vitals/Vitals";
import { useAuth } from "../context/AuthContext";
import { fmtNum } from "../lib/format";
import { clinicalService } from "../services/clinical";
import type { WardBed } from "../types";

const Ward3D = lazy(() => import("../components/ward/Ward3D").then((m) => ({ default: m.Ward3D })));

function BedCard({ bed, onClick, selected }: { bed: WardBed; onClick: () => void; selected: boolean }) {
  const v = bed.vitals;
  const a = alarmByParam(bed.alarms);
  const tone = bed.alarms.highest === "high" ? "border-alarm-high bg-red-50/40" : bed.alarms.highest === "medium" ? "border-alarm-medium bg-amber-50/40" : bed.alarms.highest === "low" ? "border-alarm-low" : "border-navy-100";
  return (
    <button
      onClick={onClick}
      className={clsx(
        "focus-ring flex min-h-44 flex-col rounded-xl border-2 bg-white p-4 text-left transition hover:shadow-md",
        tone,
        selected && "ring-2 ring-navy-700 ring-offset-2",
        bed.alarms.items.some((x) => x.priority === "high" && !x.acknowledged) && "alarm-flash",
      )}
    >
      <div className="flex w-full items-center justify-between">
        <span className="rounded-md bg-navy-900 px-2 py-0.5 text-sm font-bold text-white">{bed.label}</span>
        {bed.patient && <Badge tone={bed.patient.acuity === "critical" ? "red" : bed.patient.acuity === "high" ? "amber" : "navy"}>{bed.patient.acuity}</Badge>}
      </div>
      {bed.patient ? (
        <>
          <div className="mt-2 truncate font-semibold text-navy-900">{bed.patient.full_name}</div>
          <div className="truncate text-xs text-navy-500">{bed.patient.diagnosis}</div>
          {bed.monitor ? (
            <div className="tabular mt-3 grid grid-cols-3 gap-2">
              {(
                [
                  ["HR", v?.hr, "text-hr", a.hr],
                  ["SpO₂", v?.spo2, "text-spo2", a.spo2],
                  ["RR", v?.rr, "text-rr", a.rr],
                ] as const
              ).map(([l, val, c, al]) => (
                <div key={l} className={clsx("rounded-md px-1", al && "bg-red-100")}>
                  <div className={clsx("text-[10px] font-bold", c)}>{l}</div>
                  <div className={clsx("text-3xl font-extrabold leading-none", bed.monitor?.connection === "offline" ? "text-slate-300" : c)}>{fmtNum(val)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 rounded-md bg-navy-50 px-2 py-1.5 text-xs font-medium text-navy-600">Not monitored — link a monitor</div>
          )}
          <div className="mt-auto flex w-full items-center justify-between gap-2 pt-3">
            <AlarmPills alarms={bed.alarms} max={2} />
            {bed.monitor && <DeviceStatus monitor={bed.monitor} />}
          </div>
        </>
      ) : (
        <div className="mt-6 flex flex-1 flex-col items-center justify-center text-sm text-navy-400">
          <BedDouble className="mb-1 size-6" />
          Available bed
        </div>
      )}
    </button>
  );
}

export default function WardOverviewPage() {
  const { profile } = useAuth();
  const q = useQuery({ queryKey: ["wards"], queryFn: clinicalService.wardOverview, refetchInterval: 30_000 });
  const [wardId, setWardId] = useState<string | null>(null);
  const [view, setView] = useState<"grid" | "3d">(() => (localStorage.getItem("acme.wardView") as "grid" | "3d") || "grid");
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => localStorage.setItem("acme.wardView", view), [view]);
  useEffect(() => {
    if (!wardId && q.data?.wards.length) {
      const pref = profile?.preferences.default_ward_id;
      setWardId(q.data.wards.find((w) => w.id === pref)?.id ?? q.data.wards[0].id);
    }
  }, [q.data, wardId, profile]);

  if (q.isLoading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-44" />)}</div>
      </div>
    );
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const ward = q.data!.wards.find((w) => w.id === wardId) ?? q.data!.wards[0];
  if (!ward) return <EmptyState title="No wards configured" description="Reset the demo data from the Simulation Lab." />;
  const sel = ward.beds.find((b) => b.id === selected) ?? null;

  return (
    <div>
      <PageHeader
        title="Ward overview"
        subtitle={`${ward.name} · ${ward.floor ?? ""}`}
        actions={
          <>
            <Tabs value={ward.id} onChange={(v) => { setWardId(v); setSelected(null); }} items={q.data!.wards.map((w) => ({ value: w.id, label: w.code }))} />
            <Tabs
              value={view}
              onChange={setView}
              items={[
                { value: "grid", label: <span className="flex items-center gap-1.5"><LayoutGrid className="size-4" /> Grid</span> },
                { value: "3d", label: <span className="flex items-center gap-1.5"><Box className="size-4" /> 3D</span> },
              ]}
            />
          </>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Occupied beds" value={`${ward.stats.occupied}/${ward.stats.beds}`} icon={<BedDouble className="size-4" />} />
        <StatCard label="Monitored" value={ward.stats.monitored} hint={`${ward.stats.occupied - ward.stats.monitored} patient(s) without monitor`} icon={<MonitorSmartphone className="size-4" />} />
        <StatCard label="Active alarms" value={ward.stats.active_alarms} tone={ward.stats.active_alarms ? "amber" : "green"} hint={`${ward.stats.unacknowledged} unacknowledged`} icon={<BellRing className="size-4" />} />
        <StatCard label="High priority" value={ward.stats.high_priority} tone={ward.stats.high_priority ? "red" : "green"} icon={<UsersRound className="size-4" />} />
      </div>

      <div className={clsx("grid gap-6", sel && "xl:grid-cols-[1fr_340px]")}>
        {view === "grid" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {ward.beds.map((b) => (
              <BedCard key={b.id} bed={b} selected={selected === b.id} onClick={() => setSelected(b.id === selected ? null : b.id)} />
            ))}
          </div>
        ) : (
          <Card className="relative h-[560px] overflow-hidden">
            <Suspense fallback={<PageLoader label="Loading 3D ward…" />}>
              <Ward3D ward={ward} selectedId={selected} onSelect={(b) => setSelected(b.id)} />
            </Suspense>
            <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-3 rounded-lg bg-white/90 px-3 py-2 text-xs font-semibold text-navy-700 shadow ring-1 ring-navy-100">
              <span className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-emerald-500" /> Normal</span>
              <span className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-amber-500" /> Medium</span>
              <span className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-red-600" /> High</span>
              <span className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-cyan-500" /> Technical</span>
              <span className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-slate-400" /> Offline / none</span>
              <span className="text-navy-400">Drag to rotate · scroll to zoom · the nurse walks to the most urgent bed</span>
            </div>
          </Card>
        )}
        {sel && (
          <Card className="h-fit p-5">
            <div className="flex items-center justify-between">
              <span className="rounded-md bg-navy-900 px-2 py-0.5 text-sm font-bold text-white">{sel.label}</span>
              <button className="text-sm text-navy-500 hover:underline" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
            {sel.patient ? (
              <>
                <div className="mt-3 text-lg font-bold">{sel.patient.full_name}</div>
                <div className="text-sm text-navy-500">
                  {sel.patient.mrn} · {sel.patient.age}y · {sel.patient.code_status}
                </div>
                <div className="mt-1 text-sm text-navy-700">{sel.patient.diagnosis}</div>
                <div className="tabular mt-4 grid grid-cols-2 gap-3">
                  {(
                    [
                      ["HR", sel.vitals?.hr, "bpm", "text-hr"],
                      ["SpO₂", sel.vitals?.spo2, "%", "text-spo2"],
                      ["RR", sel.vitals?.rr, "rpm", "text-rr"],
                      ["NIBP", sel.vitals ? `${fmtNum(sel.vitals.sbp)}/${fmtNum(sel.vitals.dbp)}` : null, "mmHg", "text-bp"],
                    ] as const
                  ).map(([l, val, u, c]) => (
                    <div key={l} className="rounded-lg bg-navy-50/60 p-2">
                      <div className={clsx("text-xs font-bold", c)}>{l}</div>
                      <div className={clsx("text-3xl font-extrabold", c)}>{typeof val === "number" ? fmtNum(val) : val ?? "--"}</div>
                      <div className="text-[11px] text-navy-400">{u}</div>
                    </div>
                  ))}
                </div>
                {sel.alarms.count > 0 && (
                  <div className="mt-4 space-y-1.5">
                    {sel.alarms.items.map((a) => (
                      <div key={a.id} className="rounded-md bg-red-50/60 px-2 py-1.5 text-xs text-navy-800">
                        <b className="uppercase">{a.priority}</b> · {a.message} {a.acknowledged && <span className="text-navy-500">(acknowledged)</span>}
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-4 flex gap-2">
                  <Link to={`/patients/${sel.patient.id}`} className="flex-1">
                    <Button className="w-full">Open patient</Button>
                  </Link>
                  {sel.alarms.count > 0 && (
                    <Link to="/alarms">
                      <Button variant="secondary">Alarms</Button>
                    </Link>
                  )}
                </div>
              </>
            ) : (
              <p className="mt-4 text-sm text-navy-500">This bed is available.</p>
            )}
            {sel.monitor && (
              <div className="mt-4 border-t border-navy-100 pt-3 text-xs text-navy-500">
                Monitor <Link className="font-semibold text-navy-800 hover:underline" to={`/devices/${sel.monitor.id}`}>{sel.monitor.asset_tag}</Link> · {sel.monitor.model}
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
