import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Link2, MonitorSmartphone, Search, Unlink, Wrench } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { BindMonitorDialog } from "../components/Dialogs";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, FilterBar, Input, Modal, PageHeader, PageLoader, Select, Skeleton, StatCard, Table, Td, Th } from "../components/ui";
import { BatteryIndicator, DeviceStatus, PriorityChip } from "../components/vitals/Vitals";
import { useAuth } from "../context/AuthContext";
import { errorMessage } from "../lib/api";
import { ALARM_TYPE_LABEL, ago, duration, fmtDate, fmtDateTime, fmtNum, SCENARIO_LABEL, titleCase } from "../lib/format";
import { can } from "../lib/roles";
import { deviceService } from "../services/devices";
import type { Monitor, MonitorBrief } from "../types";
import { MaintenanceForm, MaintenanceStatusBadge } from "./MaintenancePage";

const STATUS_TONE = { in_use: "green", available: "navy", maintenance: "amber", retired: "gray" } as const;

export function DevicesPage() {
  const { profile } = useAuth();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [model, setModel] = useState("");
  const [bind, setBind] = useState<MonitorBrief | null>(null);
  const list = useQuery({ queryKey: ["monitors", status, model], queryFn: () => deviceService.list({ status: status || undefined, model: model || undefined }), refetchInterval: 20_000 });
  const all = list.data ?? [];
  const rows = all.filter((m) => !q || `${m.asset_tag} ${m.serial_number} ${m.model} ${m.bed?.label ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const models = [...new Set(all.map((m) => m.model))];

  return (
    <div>
      <PageHeader title="Devices" subtitle="Patient monitors, bed assignments and device health" />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Monitors" value={all.length || "–"} icon={<MonitorSmartphone className="size-4" />} />
        <StatCard label="In use" value={all.filter((m) => m.status === "in_use").length} tone="green" />
        <StatCard label="Offline / faults" value={all.filter((m) => m.status === "in_use" && (m.connection === "offline" || m.sensor_status === "fault")).length} tone="red" />
        <StatCard label="Maintenance due" value={all.filter((m) => m.maintenance_overdue || m.status === "maintenance").length} tone="amber" icon={<Wrench className="size-4" />} />
      </div>
      <FilterBar>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-navy-400" />
          <Input className="pl-9" placeholder="Asset tag, serial, model, bed" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search devices" />
        </div>
        <Select className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {["in_use", "available", "maintenance", "retired"].map((s) => (
            <option key={s} value={s}>{titleCase(s)}</option>
          ))}
        </Select>
        <Select className="w-auto" value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model">
          <option value="">All models</option>
          {models.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </Select>
      </FilterBar>
      <Card>
        {list.isLoading ? (
          <div className="space-y-2 p-4">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : list.error ? (
          <div className="p-4"><ErrorState error={list.error} onRetry={() => list.refetch()} /></div>
        ) : !rows.length ? (
          <EmptyState title="No devices match" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Asset</Th>
                <Th>Model</Th>
                <Th>Status</Th>
                <Th>Bed / patient</Th>
                <Th>Health</Th>
                <Th>Next PM</Th>
                <Th>Issues</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((m: Monitor) => (
                <tr key={m.id} className="hover:bg-navy-50/40">
                  <Td>
                    <Link to={`/devices/${m.id}`} className="font-bold hover:underline">{m.asset_tag}</Link>
                    <div className="text-xs text-navy-500">{m.serial_number}</div>
                  </Td>
                  <Td>
                    {m.model}
                    <div className="text-xs text-navy-500">FW {m.firmware}</div>
                  </Td>
                  <Td><Badge tone={STATUS_TONE[m.status]}>{titleCase(m.status)}</Badge></Td>
                  <Td>
                    {m.bed ? (
                      <>
                        <span className="font-bold">{m.bed.label}</span>
                        <div className="text-xs text-navy-500">{m.patient?.full_name ?? "Empty bed"}</div>
                      </>
                    ) : (
                      <span className="text-navy-400">—</span>
                    )}
                  </Td>
                  <Td>{m.status === "in_use" ? <DeviceStatus monitor={m} /> : <BatteryIndicator level={m.battery_level} />}</Td>
                  <Td className={m.maintenance_overdue ? "font-semibold text-red-600" : ""}>{fmtDate(m.next_maintenance_due)}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {m.technical_alarms?.map((a) => (
                        <PriorityChip key={a.type} priority={a.priority}>{ALARM_TYPE_LABEL[a.type]}</PriorityChip>
                      ))}
                      {!!m.open_work_orders && <Badge tone="amber">{m.open_work_orders} work order(s)</Badge>}
                    </div>
                  </Td>
                  <Td className="text-right">
                    {can.bindMonitor(profile?.role) && (m.status === "in_use" || m.status === "available") && (
                      <Button size="sm" variant="secondary" icon={m.bed_id ? <Unlink className="size-4" /> : <Link2 className="size-4" />} onClick={() => setBind(m)}>
                        {m.bed_id ? "Unlink" : "Link to bed"}
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <BindMonitorDialog monitor={bind} onClose={() => setBind(null)} />
    </div>
  );
}

export function DeviceDetailPage() {
  const { id = "" } = useParams();
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [bind, setBind] = useState<MonitorBrief | null>(null);
  const [schedule, setSchedule] = useState(false);
  const [edit, setEdit] = useState(false);
  const [fw, setFw] = useState("");
  const [due, setDue] = useState("");
  const q = useQuery({ queryKey: ["monitor", id], queryFn: () => deviceService.get(id) });
  const upd = useMutation({
    mutationFn: (body: Parameters<typeof deviceService.update>[1]) => deviceService.update(id, body),
    onSuccess: () => {
      toast.success("Device updated");
      setEdit(false);
      qc.invalidateQueries({ queryKey: ["monitor", id] });
      qc.invalidateQueries({ queryKey: ["monitors"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const m = q.data!;
  const manage = can.manageDevices(profile?.role);

  return (
    <div>
      <Link to="/devices" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-navy-600 hover:underline">
        <ArrowLeft className="size-4" /> Devices
      </Link>
      <PageHeader
        title={<span className="flex items-center gap-3">{m.asset_tag} <Badge tone={STATUS_TONE[m.status]}>{titleCase(m.status)}</Badge></span>}
        subtitle={`${m.manufacturer} ${m.model} · S/N ${m.serial_number} · firmware ${m.firmware}`}
        actions={
          <>
            {can.bindMonitor(profile?.role) && (m.status === "in_use" || m.status === "available") && (
              <Button variant="secondary" onClick={() => setBind(m)}>{m.bed_id ? "Unlink from bed" : "Link to bed"}</Button>
            )}
            {manage && !m.bed_id && m.status === "available" && (
              <Button variant="secondary" onClick={() => upd.mutate({ status: "maintenance" })}>Send to maintenance</Button>
            )}
            {manage && m.status === "maintenance" && (
              <Button variant="secondary" onClick={() => upd.mutate({ status: "available" })}>Return to service</Button>
            )}
            {manage && (
              <Button variant="secondary" onClick={() => { setFw(m.firmware); setDue(m.next_maintenance_due ?? ""); setEdit(true); }}>Edit</Button>
            )}
            {manage && <Button icon={<Wrench className="size-4" />} onClick={() => setSchedule(true)}>Schedule maintenance</Button>}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5">
          <h3 className="mb-3 font-semibold">Current status</h3>
          <dl className="space-y-2.5 text-sm">
            <div className="flex justify-between"><dt className="text-navy-500">Bed</dt><dd className="font-semibold">{m.bed ? `${m.bed.label} · ${m.bed.ward_name}` : "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-navy-500">Patient</dt><dd className="font-semibold">{m.patient ? <Link className="hover:underline" to={`/patients/${m.patient.id}`}>{m.patient.full_name}</Link> : "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-navy-500">Connection</dt><dd><DeviceStatus monitor={m} /></dd></div>
            <div className="flex justify-between"><dt className="text-navy-500">Last seen</dt><dd>{ago(m.last_seen_at)}</dd></div>
            <div className="flex justify-between"><dt className="text-navy-500">Simulated scenario</dt><dd>{SCENARIO_LABEL[m.scenario]}</dd></div>
            <div className="flex justify-between"><dt className="text-navy-500">Last maintenance</dt><dd>{fmtDate(m.last_maintenance_at)}</dd></div>
            <div className="flex justify-between"><dt className="text-navy-500">Next PM due</dt><dd className="font-semibold">{fmtDate(m.next_maintenance_due)}</dd></div>
          </dl>
          {m.state && (
            <div className="tabular mt-4 grid grid-cols-3 gap-2 rounded-lg bg-navy-50/60 p-3 text-center">
              <div><div className="text-xs font-bold text-hr">HR</div><div className="text-2xl font-extrabold text-hr">{fmtNum(m.state.hr)}</div></div>
              <div><div className="text-xs font-bold text-spo2">SpO₂</div><div className="text-2xl font-extrabold text-spo2">{fmtNum(m.state.spo2)}</div></div>
              <div><div className="text-xs font-bold text-rr">RR</div><div className="text-2xl font-extrabold text-rr">{fmtNum(m.state.rr)}</div></div>
            </div>
          )}
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Maintenance history" subtitle="Work orders, inspections and service documents" />
          <div className="divide-y divide-navy-50">
            {m.maintenance.map((r) => (
              <div key={r.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
                <MaintenanceStatusBadge status={r.status} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{titleCase(r.type)} · {fmtDate(r.scheduled_for)}</div>
                  <div className="text-sm text-navy-600">{r.description}</div>
                  {r.resolution && <div className="mt-0.5 text-xs text-navy-500">Resolution: {r.resolution}</div>}
                </div>
                <div className="text-right text-xs text-navy-500">{r.technician_name}{r.completed_at && <div>Completed {fmtDate(r.completed_at)}</div>}</div>
              </div>
            ))}
            {!m.maintenance.length && <div className="px-5 py-8 text-center text-sm text-navy-500">No maintenance records.</div>}
          </div>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Technical alarms" />
          <div className="divide-y divide-navy-50">
            {m.technical_alarms.map((a) => (
              <div key={a.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                <PriorityChip priority={a.priority}>{ALARM_TYPE_LABEL[a.type]}</PriorityChip>
                <span className="flex-1">{a.message}</span>
                <span className="text-xs text-navy-500">{fmtDateTime(a.started_at)} · {a.state === "active" ? "ongoing" : `lasted ${duration(a.started_at, a.cleared_at)}`}</span>
              </div>
            ))}
            {!m.technical_alarms.length && <div className="px-5 py-8 text-center text-sm text-navy-500">No technical alarms.</div>}
          </div>
        </Card>
        <Card>
          <CardHeader title="Device log" />
          <div className="max-h-96 divide-y divide-navy-50 overflow-y-auto">
            {m.events.map((e) => (
              <div key={e.id} className="px-5 py-2 text-xs">
                <div className="text-navy-400">{fmtDateTime(e.occurred_at)} · {e.source}</div>
                <div className="text-navy-800">{e.message}</div>
              </div>
            ))}
            {!m.events.length && <div className="px-5 py-8 text-center text-sm text-navy-500">No events.</div>}
          </div>
        </Card>
      </div>
      <BindMonitorDialog monitor={bind} onClose={() => { setBind(null); q.refetch(); }} />
      <MaintenanceForm open={schedule} onClose={() => { setSchedule(false); q.refetch(); }} monitorId={m.id} />
      <Modal
        open={edit}
        onClose={() => setEdit(false)}
        title={`Edit ${m.asset_tag}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEdit(false)}>Cancel</Button>
            <Button loading={upd.isPending} onClick={() => upd.mutate({ firmware: fw, next_maintenance_due: due || undefined })}>Save</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Firmware version"><Input value={fw} onChange={(e) => setFw(e.target.value)} /></Field>
          <Field label="Next preventive maintenance due"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        </div>
      </Modal>
    </div>
  );
}
