import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { BellOff, CheckCircle2, Search } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { AckAlarmDialog } from "../components/Dialogs";
import { Badge, Button, Card, EmptyState, ErrorState, FilterBar, Input, PageHeader, Select, Skeleton, StatCard, Table, Tabs, Td, Th } from "../components/ui";
import { PriorityChip } from "../components/vitals/Vitals";
import { ALARM_TYPE_LABEL, duration, fmtDateTime, fmtTime } from "../lib/format";
import { alarmService } from "../services/alarms";
import { clinicalService } from "../services/clinical";
import type { Alarm } from "../types";

export default function AlarmsPage() {
  const [state, setState] = useState<"active" | "cleared" | "all">("active");
  const [priority, setPriority] = useState("");
  const [kind, setKind] = useState("");
  const [ward, setWard] = useState("");
  const [ackF, setAckF] = useState("");
  const [q, setQ] = useState("");
  const [ack, setAck] = useState<Alarm | null>(null);
  const wards = useQuery({ queryKey: ["wards"], queryFn: clinicalService.wardOverview });
  const counts = useQuery({ queryKey: ["alarm-counts"], queryFn: alarmService.counts });
  const list = useQuery({
    queryKey: ["alarms", state, priority, kind, ward, ackF],
    queryFn: () =>
      alarmService.list({ state, priority: priority || undefined, kind: kind || undefined, ward_id: ward || undefined, acknowledged: ackF ? ackF === "yes" : undefined, limit: 300 }),
    refetchInterval: 20_000,
  });
  const rows = (list.data ?? []).filter((a) => !q || `${a.message} ${a.patient?.full_name ?? ""} ${a.bed?.label ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const c = counts.data;

  return (
    <div>
      <PageHeader title="Alarms" subtitle="Acknowledging silences and documents the response — the alarm stays active until the condition resolves." />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Active" value={c?.active ?? "–"} tone={c?.active ? "amber" : "green"} />
        <StatCard label="Unacknowledged" value={c?.unacknowledged ?? "–"} tone={c?.unacknowledged ? "red" : "green"} />
        <StatCard label="High priority" value={c?.high ?? "–"} tone={c?.high ? "red" : "green"} hint={`${c?.high_unacknowledged ?? 0} awaiting response`} />
        <StatCard label="Technical" value={c?.technical ?? "–"} hint="Battery, sensor, connection" />
      </div>
      <FilterBar>
        <Tabs value={state} onChange={setState} items={[{ value: "active", label: "Active" }, { value: "cleared", label: "Resolved" }, { value: "all", label: "All" }]} />
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-navy-400" />
          <Input className="pl-9" placeholder="Search alarms" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search alarms" />
        </div>
        <Select className="w-auto" value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Priority">
          <option value="">All priorities</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </Select>
        <Select className="w-auto" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
          <option value="">Clinical & technical</option>
          <option value="physiological">Physiological</option>
          <option value="technical">Technical</option>
        </Select>
        <Select className="w-auto" value={ackF} onChange={(e) => setAckF(e.target.value)} aria-label="Acknowledgement">
          <option value="">Any acknowledgement</option>
          <option value="no">Unacknowledged</option>
          <option value="yes">Acknowledged</option>
        </Select>
        <Select className="w-auto" value={ward} onChange={(e) => setWard(e.target.value)} aria-label="Ward">
          <option value="">All wards</option>
          {wards.data?.wards.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
      </FilterBar>
      <Card>
        {list.isLoading ? (
          <div className="space-y-2 p-4">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : list.error ? (
          <div className="p-4"><ErrorState error={list.error} onRetry={() => list.refetch()} /></div>
        ) : !rows.length ? (
          <EmptyState icon={state === "active" ? <CheckCircle2 className="size-6 text-emerald-600" /> : <BellOff className="size-6" />} title={state === "active" ? "No active alarms" : "No alarms found"} description={state === "active" ? "All monitored patients are within their limits." : "Adjust the filters to see more."} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Priority</Th>
                <Th>Bed / patient</Th>
                <Th>Alarm</Th>
                <Th>Started</Th>
                <Th>Duration</Th>
                <Th>Condition</Th>
                <Th>Response</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className={clsx("hover:bg-navy-50/40", a.state === "active" && !a.acknowledged_at && a.priority === "high" && "bg-red-50/50")}>
                  <Td><PriorityChip priority={a.priority} /></Td>
                  <Td>
                    <div className="font-bold">{a.bed?.label ?? "—"}</div>
                    {a.patient ? (
                      <Link to={`/patients/${a.patient.id}`} className="text-xs font-medium text-navy-600 hover:underline">
                        {a.patient.full_name}
                      </Link>
                    ) : (
                      <span className="text-xs text-navy-400">{a.monitor?.asset_tag}</span>
                    )}
                  </Td>
                  <Td>
                    <div className="font-semibold">{ALARM_TYPE_LABEL[a.type] ?? a.type}</div>
                    <div className="text-xs text-navy-500">{a.message}</div>
                  </Td>
                  <Td className="tabular whitespace-nowrap text-xs">{state === "active" ? fmtTime(a.started_at) : fmtDateTime(a.started_at)}</Td>
                  <Td className="tabular whitespace-nowrap text-xs">{duration(a.started_at, a.cleared_at)}</Td>
                  <Td>{a.state === "active" ? <Badge tone="red">Ongoing</Badge> : <Badge tone="green">Resolved</Badge>}</Td>
                  <Td className="text-xs">
                    {a.acknowledged_at ? (
                      <>
                        <div className="font-semibold text-navy-800">Ack · {a.acknowledged_by_name}</div>
                        <div className="text-navy-500">
                          after {duration(a.started_at, a.acknowledged_at)}
                          {a.ack_note && ` — “${a.ack_note}”`}
                        </div>
                      </>
                    ) : (
                      <span className="font-semibold text-red-600">Awaiting response</span>
                    )}
                  </Td>
                  <Td className="text-right">{!a.acknowledged_at && <Button size="sm" onClick={() => setAck(a)}>Acknowledge</Button>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <AckAlarmDialog alarm={ack} onClose={() => setAck(null)} />
    </div>
  );
}
