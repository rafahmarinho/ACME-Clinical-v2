import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, FileDown, FileSpreadsheet, FileText, HeartPulse, MonitorSmartphone } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, PageHeader, Select, Skeleton } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { errorMessage } from "../lib/api";
import { ALARM_TYPE_LABEL, fmtDateTime, titleCase } from "../lib/format";
import { reportService } from "../services/admin";
import { clinicalService } from "../services/clinical";
import type { Report } from "../types";

const TYPES = [
  { id: "alarm_summary", label: "Alarm summary", icon: BellRing, desc: "Counts by type and priority, response times" },
  { id: "patient_vitals", label: "Patient vitals", icon: HeartPulse, desc: "Min / mean / max per patient" },
  { id: "device_status", label: "Device status", icon: MonitorSmartphone, desc: "Health, battery and maintenance" },
] as const;

function Summary({ r }: { r: Report }) {
  const s = r.summary as Record<string, any>;
  if (r.type === "alarm_summary") {
    const data = Object.entries((s.by_type ?? {}) as Record<string, number>).map(([k, v]) => ({ name: ALARM_TYPE_LABEL[k] ?? k, count: v }));
    return (
      <div className="space-y-4">
        <div className="tabular grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[["Total", s.total], ["Still active", s.active], ["Acknowledged", `${s.acknowledged_pct}%`], ["Mean time to ack", s.mean_time_to_ack_s != null ? `${Math.round(s.mean_time_to_ack_s)}s` : "—"]].map(([l, v]) => (
            <div key={l} className="rounded-lg bg-navy-50/60 p-3"><div className="text-xs text-navy-500">{l}</div><div className="text-3xl font-extrabold">{v}</div></div>
          ))}
        </div>
        {data.length > 0 && (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data} margin={{ left: -16 }}>
              <CartesianGrid stroke="#e8eef8" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#4a68a8" }} interval={0} angle={-15} height={50} textAnchor="end" />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#4a68a8" }} />
              <Tooltip />
              <Bar dataKey="count" fill="#1e3a74" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    );
  }
  if (r.type === "patient_vitals") {
    const rows = (s.per_patient ?? []) as { bed: string; name: string; readings: number; alarms: number; mean: Record<string, number | null> }[];
    return (
      <div className="overflow-x-auto">
        <table className="tabular w-full text-sm">
          <thead><tr className="text-left text-xs uppercase text-navy-500"><th className="py-1">Bed</th><th>Patient</th><th className="text-right">HR</th><th className="text-right">SpO₂</th><th className="text-right">RR</th><th className="text-right">SYS/DIA</th><th className="text-right">Alarms</th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.bed} className="border-t border-navy-50">
                <td className="py-1.5 font-bold">{p.bed}</td><td>{p.name}</td>
                <td className="text-right font-semibold text-hr">{p.mean.hr?.toFixed(0)}</td>
                <td className="text-right font-semibold text-spo2">{p.mean.spo2?.toFixed(0)}</td>
                <td className="text-right font-semibold text-rr">{p.mean.rr?.toFixed(0)}</td>
                <td className="text-right font-semibold text-bp">{p.mean.sbp?.toFixed(0)}/{p.mean.dbp?.toFixed(0)}</td>
                <td className="text-right">{p.alarms}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-navy-500">Mean values · {s.readings} readings analysed</p>
      </div>
    );
  }
  return (
    <div className="tabular grid grid-cols-2 gap-3 sm:grid-cols-5">
      {[["Monitors", s.total], ["Offline in use", s.offline], ["Low battery", s.low_battery], ["PM overdue", s.maintenance_overdue], ["Open work orders", s.open_work_orders]].map(([l, v]) => (
        <div key={l} className="rounded-lg bg-navy-50/60 p-3"><div className="text-xs text-navy-500">{l}</div><div className="text-3xl font-extrabold">{v}</div></div>
      ))}
    </div>
  );
}

export default function ReportsPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const biomed = profile?.role === "biomed";
  const [type, setType] = useState<Report["type"]>(biomed ? "device_status" : "alarm_summary");
  const [hours, setHours] = useState("24");
  const [ward, setWard] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const wards = useQuery({ queryKey: ["wards"], queryFn: clinicalService.wardOverview });
  const list = useQuery({ queryKey: ["reports"], queryFn: reportService.list });
  const gen = useMutation({
    mutationFn: () => reportService.create({ type, hours: Number(hours), ward_id: ward || null }),
    onSuccess: (r) => { toast.success("Report generated"); setSelected(r.id); qc.invalidateQueries({ queryKey: ["reports"] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const download = async (id: string, f: "csv" | "pdf") => {
    try { window.open((await reportService.download(id, f)).url, "_blank", "noopener"); } catch (e) { toast.error(errorMessage(e)); }
  };
  const current = list.data?.find((r) => r.id === selected) ?? list.data?.[0];
  const types = TYPES.filter((t) => !biomed || t.id === "device_status");

  return (
    <div>
      <PageHeader title="Reports" subtitle="Generated by the ACME Clinical engine · downloadable as PDF and CSV" />
      <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="New report" />
            <div className="space-y-4 p-5">
              <div className="grid gap-2">
                {types.map((t) => (
                  <button key={t.id} onClick={() => setType(t.id)} className={`focus-ring flex items-start gap-3 rounded-lg border-2 p-3 text-left ${type === t.id ? "border-navy-800 bg-navy-50/60" : "border-navy-100 hover:bg-navy-50/40"}`}>
                    <t.icon className="mt-0.5 size-5 text-navy-700" />
                    <div><div className="text-sm font-semibold">{t.label}</div><div className="text-xs text-navy-500">{t.desc}</div></div>
                  </button>
                ))}
              </div>
              {type !== "device_status" && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Period">
                    <Select value={hours} onChange={(e) => setHours(e.target.value)}>
                      <option value="1">Last hour</option><option value="8">Last 8 hours (shift)</option><option value="24">Last 24 hours</option><option value="168">Last 7 days</option>
                    </Select>
                  </Field>
                  <Field label="Ward">
                    <Select value={ward} onChange={(e) => setWard(e.target.value)}>
                      <option value="">All wards</option>
                      {wards.data?.wards.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}
                    </Select>
                  </Field>
                </div>
              )}
              <Button className="w-full" loading={gen.isPending} icon={<FileText className="size-4" />} onClick={() => gen.mutate()}>Generate report</Button>
            </div>
          </Card>
          <Card>
            <CardHeader title="Report history" />
            {list.isLoading ? <div className="space-y-2 p-4">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div> : list.error ? <div className="p-4"><ErrorState error={list.error} onRetry={() => list.refetch()} /></div> : !list.data?.length ? (
              <EmptyState title="No reports yet" description="Generate your first report above." />
            ) : (
              <ul className="max-h-[420px] divide-y divide-navy-50 overflow-y-auto">
                {list.data.map((r) => (
                  <li key={r.id}>
                    <button onClick={() => setSelected(r.id)} className={`w-full px-5 py-3 text-left hover:bg-navy-50/50 ${current?.id === r.id ? "bg-navy-50" : ""}`}>
                      <div className="text-sm font-semibold">{r.title}</div>
                      <div className="text-xs text-navy-500">{fmtDateTime(r.created_at)} · {r.created_by_name}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card className="h-fit">
          {current ? (
            <>
              <CardHeader
                title={current.title}
                subtitle={`${titleCase(current.type)} · ${current.type === "device_status" ? "snapshot" : `last ${current.params.hours}h`} · ${fmtDateTime(current.created_at)} by ${current.created_by_name}`}
                action={
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" icon={<FileSpreadsheet className="size-4" />} onClick={() => download(current.id, "csv")}>CSV</Button>
                    <Button size="sm" icon={<FileDown className="size-4" />} onClick={() => download(current.id, "pdf")}>PDF</Button>
                  </div>
                }
              />
              <div className="p-5">
                <Summary r={current} />
                <div className="mt-4"><Badge tone="gray">{String((current.summary as { rows?: number }).rows ?? 0)} rows in export</Badge></div>
              </div>
            </>
          ) : (
            <EmptyState title="Select or generate a report" />
          )}
        </Card>
      </div>
    </div>
  );
}
