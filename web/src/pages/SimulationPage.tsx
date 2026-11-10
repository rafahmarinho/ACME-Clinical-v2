import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertTriangle, BatteryLow, FastForward, HeartPulse, Pause, Play, RotateCcw, Search, StepForward, Unplug, WifiOff, Wind } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Badge, Button, Card, CardHeader, ErrorState, FilterBar, Input, Modal, PageHeader, PageLoader, Select, Tabs } from "../components/ui";
import { DeviceStatus } from "../components/vitals/Vitals";
import { errorMessage } from "../lib/api";
import { fmtDateTime, fmtTime, SCENARIO_LABEL, titleCase } from "../lib/format";
import { simulationService } from "../services/admin";
import type { Scenario } from "../types";

const SCENARIOS: { id: Scenario; icon: typeof HeartPulse; desc: string; tone: string }[] = [
  { id: "normal", icon: HeartPulse, desc: "Vitals around the patient’s baseline", tone: "text-emerald-600" },
  { id: "low_spo2", icon: Wind, desc: "Gradual desaturation to ~84%, HR and RR rise", tone: "text-red-600" },
  { id: "low_battery", icon: BatteryLow, desc: "Monitor unplugged, battery drains quickly", tone: "text-amber-600" },
  { id: "sensor_fault", icon: Unplug, desc: "SpO₂ probe reports invalid signal", tone: "text-amber-600" },
  { id: "connection_loss", icon: WifiOff, desc: "Monitor stops reporting to the station", tone: "text-slate-600" },
];

function EventLog() {
  const [source, setSource] = useState("");
  const [severity, setSeverity] = useState("");
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"events" | "integrations">("events");
  const ev = useQuery({ queryKey: ["events", source, severity, q], queryFn: () => simulationService.events({ source: source || undefined, severity: severity || undefined, q: q || undefined, limit: 200 }), enabled: tab === "events" });
  const msgs = useQuery({ queryKey: ["events", "integrations"], queryFn: () => simulationService.messages(), enabled: tab === "integrations" });
  return (
    <Card>
      <CardHeader title="Event log" subtitle="Everything the simulator, users and simulated integrations did" action={<Tabs value={tab} onChange={setTab} items={[{ value: "events", label: "Events" }, { value: "integrations", label: "Integrations" }]} />} />
      {tab === "events" ? (
        <>
          <div className="border-b border-navy-100 px-5 py-3">
            <FilterBar>
              <div className="relative w-full sm:w-60">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-navy-400" />
                <Input className="h-9 pl-9" placeholder="Search events" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search events" />
              </div>
              <Select className="h-9 w-auto" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
                <option value="">All sources</option>{["simulation", "user", "system", "integration"].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
              </Select>
              <Select className="h-9 w-auto" value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Severity">
                <option value="">All severities</option>{["info", "warning", "critical"].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
              </Select>
            </FilterBar>
          </div>
          <div className="max-h-[520px] overflow-y-auto">
            {ev.isLoading && <PageLoader />}
            {ev.error && <div className="p-4"><ErrorState error={ev.error} onRetry={() => ev.refetch()} /></div>}
            <ul className="divide-y divide-navy-50">
              {ev.data?.map((e) => (
                <li key={e.id} className="flex gap-3 px-5 py-2.5 text-sm">
                  <span className={clsx("mt-1.5 size-2 shrink-0 rounded-full", e.severity === "critical" ? "bg-red-600" : e.severity === "warning" ? "bg-amber-500" : "bg-navy-300")} />
                  <div className="min-w-0 flex-1">
                    <div className="text-navy-900">{e.message}</div>
                    <div className="text-xs text-navy-500">
                      {fmtDateTime(e.occurred_at)} · {e.source}{e.tick != null && ` · tick ${e.tick}`}{e.actor_name && ` · ${e.actor_name}`} · <span className="font-mono">{e.type}</span>
                    </div>
                  </div>
                </li>
              ))}
              {ev.data && !ev.data.length && <li className="px-5 py-8 text-center text-sm text-navy-500">No events match.</li>}
            </ul>
          </div>
        </>
      ) : (
        <div className="max-h-[560px] overflow-y-auto">
          <ul className="divide-y divide-navy-50">
            {msgs.data?.map((m) => (
              <li key={m.id} className="px-5 py-2.5 text-sm">
                <div className="flex items-center gap-2"><Badge tone={m.channel === "pager" ? "red" : m.channel === "ehr" ? "cyan" : "navy"}>{m.channel.toUpperCase()}</Badge><span className="font-semibold">{m.subject}</span><Badge tone="green" className="ml-auto">{m.status}</Badge></div>
                <div className="mt-0.5 text-xs text-navy-500">To {m.recipient} · {fmtDateTime(m.created_at)}</div>
                <div className="mt-0.5 text-navy-700">{m.body}</div>
              </li>
            ))}
            {msgs.data && !msgs.data.length && <li className="px-5 py-8 text-center text-sm text-navy-500">No outbound messages yet.</li>}
          </ul>
        </div>
      )}
    </Card>
  );
}

export default function SimulationPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmReset, setConfirmReset] = useState(false);
  const o = useQuery({ queryKey: ["simulation"], queryFn: simulationService.overview, refetchInterval: 15_000 });
  const refreshAll = () => qc.invalidateQueries();
  const running = useMutation({ mutationFn: (r: boolean) => simulationService.setRunning(r), onSuccess: (_, r) => { toast.success(r ? "Live simulation started" : "Live simulation paused"); refreshAll(); }, onError: (e) => toast.error(errorMessage(e)) });
  const adv = useMutation({
    mutationFn: (n: number) => simulationService.advance(n),
    onSuccess: (r) => { toast.success(`Advanced ${r.ticks} tick(s): ${r.readings} readings, ${r.alarms_raised} alarm(s) raised, ${r.alarms_cleared} cleared`); refreshAll(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const scen = useMutation({
    mutationFn: ({ ids, s }: { ids: string[]; s: Scenario }) => simulationService.setBulk(ids, s),
    onSuccess: (_, v) => { toast.success(`${SCENARIO_LABEL[v.s]} applied to ${v.ids.length} monitor(s) — advance the simulation to see the effect`); setSelected(new Set()); qc.invalidateQueries({ queryKey: ["simulation"] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const reset = useMutation({
    mutationFn: simulationService.reset,
    onSuccess: (r) => { toast.success(`Demo data reset: ${r.patients} patients, ${r.monitors} monitors`); setConfirmReset(false); refreshAll(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (o.isLoading) return <PageLoader />;
  if (o.error) return <ErrorState error={o.error} onRetry={() => o.refetch()} />;
  const { state, monitors } = o.data!;
  const sim = monitors.filter((m) => m.simulated);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div>
      <PageHeader title="Simulation Lab" subtitle="Drive the simulated monitors: choose scenarios, advance time, review events, reset the demo." actions={<Button variant="danger" icon={<RotateCcw className="size-4" />} onClick={() => setConfirmReset(true)}>Reset demo data</Button>} />
      <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_auto]">
        <Card className="flex flex-wrap items-center gap-6 p-5">
          <div>
            <div className="text-xs font-semibold uppercase text-navy-500">Status</div>
            <div className={clsx("text-2xl font-extrabold", state.running ? "text-emerald-600" : "text-navy-900")}>{state.running ? "Running" : "Paused"}</div>
          </div>
          <div><div className="text-xs font-semibold uppercase text-navy-500">Tick</div><div className="tabular text-2xl font-extrabold">{state.tick}</div></div>
          <div><div className="text-xs font-semibold uppercase text-navy-500">Sim clock</div><div className="tabular text-2xl font-extrabold">{fmtTime(state.sim_time)}</div></div>
          <div><div className="text-xs font-semibold uppercase text-navy-500">Tick length</div><div className="tabular text-2xl font-extrabold">{state.tick_seconds}s</div></div>
          <div><div className="text-xs font-semibold uppercase text-navy-500">Simulated monitors</div><div className="tabular text-2xl font-extrabold">{sim.length}</div></div>
        </Card>
        <Card className="flex flex-wrap items-center gap-2 p-5">
          {state.running ? (
            <Button size="lg" variant="secondary" icon={<Pause className="size-5" />} loading={running.isPending} onClick={() => running.mutate(false)}>Pause live</Button>
          ) : (
            <Button size="lg" variant="success" icon={<Play className="size-5" />} loading={running.isPending} onClick={() => running.mutate(true)}>Start live</Button>
          )}
          <Button size="lg" variant="secondary" icon={<StepForward className="size-5" />} loading={adv.isPending && adv.variables === 1} onClick={() => adv.mutate(1)}>+1 tick</Button>
          <Button size="lg" variant="secondary" icon={<FastForward className="size-5" />} loading={adv.isPending && adv.variables === 12} onClick={() => adv.mutate(12)}>+1 min</Button>
          <Button size="lg" variant="secondary" icon={<FastForward className="size-5" />} loading={adv.isPending && adv.variables === 60} onClick={() => adv.mutate(60)}>+5 min</Button>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader
          title="Monitor scenarios"
          subtitle="Select monitors, then apply a scenario. Changes take effect on the next tick."
          action={
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(sim.map((m) => m.id)))}>Select all</Button>
              <Button size="sm" variant="ghost" disabled={!selected.size} onClick={() => setSelected(new Set())}>Clear</Button>
            </div>
          }
        />
        <div className="grid gap-2 border-b border-navy-100 p-4 sm:grid-cols-2 xl:grid-cols-5">
          {SCENARIOS.map((s) => (
            <button key={s.id} disabled={!selected.size || scen.isPending} onClick={() => scen.mutate({ ids: [...selected], s: s.id })} className="focus-ring flex items-start gap-3 rounded-lg border-2 border-navy-100 p-3 text-left transition enabled:hover:border-navy-700 enabled:hover:bg-navy-50 disabled:opacity-50">
              <s.icon className={clsx("mt-0.5 size-5 shrink-0", s.tone)} />
              <div><div className="text-sm font-semibold">{SCENARIO_LABEL[s.id]}</div><div className="text-xs text-navy-500">{s.desc}</div></div>
            </button>
          ))}
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
          {monitors.map((m) => (
            <label key={m.id} className={clsx("flex cursor-pointer items-start gap-3 rounded-lg border-2 p-3", !m.simulated && "cursor-not-allowed opacity-60", selected.has(m.id) ? "border-navy-800 bg-navy-50/60" : "border-navy-100")}>
              <input type="checkbox" className="mt-1 size-4 accent-navy-900" checked={selected.has(m.id)} disabled={!m.simulated} onChange={() => toggle(m.id)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold">{m.asset_tag}</span>
                  {m.bed ? <span className="rounded bg-navy-900 px-1.5 text-xs font-bold text-white">{m.bed.label}</span> : <Badge tone="gray">{titleCase(m.status)}</Badge>}
                </div>
                <div className="truncate text-xs text-navy-500">{m.patient ? <Link to={`/patients/${m.patient.id}`} className="hover:underline">{m.patient.full_name}</Link> : m.simulated ? "Empty bed" : "Not linked to a bed"}</div>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <Badge tone={m.scenario === "normal" ? "green" : m.scenario === "low_spo2" ? "red" : "amber"}>{SCENARIO_LABEL[m.scenario]}</Badge>
                  {m.simulated && <DeviceStatus monitor={m} />}
                </div>
              </div>
            </label>
          ))}
        </div>
      </Card>
      <EventLog />

      <Modal open={confirmReset} onClose={() => setConfirmReset(false)} title="Reset demo data?" footer={<><Button variant="secondary" onClick={() => setConfirmReset(false)}>Cancel</Button><Button variant="danger" loading={reset.isPending} onClick={() => reset.mutate()}>Reset everything</Button></>}>
        <div className="flex gap-3 text-sm text-navy-700">
          <AlertTriangle className="size-5 shrink-0 text-red-600" />
          <p>All patients, monitors, readings, alarms, observations, maintenance records, reports and events will be replaced with the original demo dataset (12 patients, 10 monitors, 2 hours of history). Staff accounts are kept. This cannot be undone.</p>
        </div>
      </Modal>
    </div>
  );
}
