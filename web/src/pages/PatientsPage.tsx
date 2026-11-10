import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Search, UsersRound } from "lucide-react";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { Badge, Card, EmptyState, ErrorState, FilterBar, Input, PageHeader, Select, Skeleton, Table, Td, Th } from "../components/ui";
import { AlarmPills, DeviceStatus } from "../components/vitals/Vitals";
import { fmtNum } from "../lib/format";
import { clinicalService } from "../services/clinical";

const ACUITY_TONE = { critical: "red", high: "amber", moderate: "navy", low: "gray" } as const;

export default function PatientsPage() {
  const [sp, setSp] = useSearchParams();
  const filters = {
    q: sp.get("q") ?? "",
    ward_id: sp.get("ward") ?? "",
    acuity: sp.get("acuity") ?? "",
    monitored: sp.get("monitored") ?? "",
    alarm: sp.get("alarm") ?? "",
  };
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    setSp(n, { replace: true });
  };
  const wards = useQuery({ queryKey: ["wards"], queryFn: clinicalService.wardOverview });
  const q = useQuery({
    queryKey: ["patients", filters.ward_id, filters.acuity, filters.monitored, filters.alarm],
    queryFn: () =>
      clinicalService.patients({
        ward_id: filters.ward_id || undefined,
        acuity: filters.acuity || undefined,
        monitored: filters.monitored ? filters.monitored === "yes" : undefined,
        alarm: filters.alarm ? filters.alarm === "yes" : undefined,
      }),
  });
  const list = useMemo(() => {
    const t = filters.q.toLowerCase();
    return (q.data ?? []).filter((p) => !t || `${p.full_name} ${p.mrn} ${p.bed?.label ?? ""} ${p.diagnosis}`.toLowerCase().includes(t));
  }, [q.data, filters.q]);

  return (
    <div>
      <PageHeader title="Patients" subtitle="Admitted patients across monitored units" />
      <FilterBar>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-navy-400" />
          <Input className="pl-9" placeholder="Name, MRN, bed or diagnosis" value={filters.q} onChange={(e) => set("q", e.target.value)} aria-label="Filter patients" />
        </div>
        <Select className="w-auto" value={filters.ward_id} onChange={(e) => set("ward", e.target.value)} aria-label="Ward">
          <option value="">All wards</option>
          {wards.data?.wards.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
        <Select className="w-auto" value={filters.acuity} onChange={(e) => set("acuity", e.target.value)} aria-label="Acuity">
          <option value="">Any acuity</option>
          {["critical", "high", "moderate", "low"].map((a) => (
            <option key={a} value={a}>
              {a[0].toUpperCase() + a.slice(1)}
            </option>
          ))}
        </Select>
        <Select className="w-auto" value={filters.monitored} onChange={(e) => set("monitored", e.target.value)} aria-label="Monitoring">
          <option value="">Monitored or not</option>
          <option value="yes">Monitored</option>
          <option value="no">Not monitored</option>
        </Select>
        <Select className="w-auto" value={filters.alarm} onChange={(e) => set("alarm", e.target.value)} aria-label="Alarms">
          <option value="">Any alarm state</option>
          <option value="yes">With active alarms</option>
          <option value="no">No active alarms</option>
        </Select>
      </FilterBar>
      <Card>
        {q.isLoading ? (
          <div className="space-y-2 p-4">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : q.error ? (
          <div className="p-4"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>
        ) : !list.length ? (
          <EmptyState icon={<UsersRound className="size-6" />} title="No patients match these filters" description="Try clearing the search or filters." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Bed</Th>
                <Th>Patient</Th>
                <Th>Diagnosis</Th>
                <Th>Acuity</Th>
                <Th className="text-right">HR</Th>
                <Th className="text-right">SpO₂</Th>
                <Th className="text-right">RR</Th>
                <Th className="text-right">NIBP</Th>
                <Th>Alarms</Th>
                <Th>Monitor</Th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const off = p.monitor?.connection === "offline";
                return (
                  <tr key={p.id} className={clsx("hover:bg-navy-50/50", p.alarms.highest === "high" && "bg-red-50/40")}>
                    <Td className="whitespace-nowrap font-bold">{p.bed?.label ?? "—"}</Td>
                    <Td>
                      <Link to={`/patients/${p.id}`} className="whitespace-nowrap font-semibold text-navy-900 hover:underline">
                        {p.last_name}, {p.first_name}
                      </Link>
                      <div className="whitespace-nowrap text-xs text-navy-500">
                        {p.mrn} · {p.age}y {p.sex === "female" ? "F" : "M"}
                      </div>
                    </Td>
                    <Td className="max-w-56 truncate text-navy-600">{p.diagnosis}</Td>
                    <Td><Badge tone={ACUITY_TONE[p.acuity]}>{p.acuity}</Badge></Td>
                    <Td className={clsx("tabular text-right text-xl font-bold", off ? "text-slate-300" : "text-hr")}>{fmtNum(p.vitals?.hr)}</Td>
                    <Td className={clsx("tabular text-right text-xl font-bold", off ? "text-slate-300" : "text-spo2")}>{fmtNum(p.vitals?.spo2)}</Td>
                    <Td className={clsx("tabular text-right text-xl font-bold", off ? "text-slate-300" : "text-rr")}>{fmtNum(p.vitals?.rr)}</Td>
                    <Td className={clsx("tabular whitespace-nowrap text-right font-bold", off ? "text-slate-300" : "text-bp")}>
                      {p.vitals ? `${fmtNum(p.vitals.sbp)}/${fmtNum(p.vitals.dbp)}` : "--"}
                    </Td>
                    <Td><AlarmPills alarms={p.alarms} max={2} /></Td>
                    <Td>{p.monitor ? <DeviceStatus monitor={p.monitor} /> : <span className="text-xs text-navy-400">Not monitored</span>}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <p className="mt-3 text-xs text-navy-400">{list.length} patient(s)</p>
    </div>
  );
}
