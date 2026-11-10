import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { Badge, Button, Card, CardHeader, ErrorState, Input, PageHeader, PageLoader, Select } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { errorMessage } from "../lib/api";
import { PARAM_META, PARAMS } from "../lib/format";
import { can } from "../lib/roles";
import { thresholdService, type LimitInput } from "../services/admin";
import { clinicalService } from "../services/clinical";
import type { Param } from "../types";

type Draft = Record<Param, { low: string; high: string; enabled: boolean; custom: boolean }>;

function LimitEditor({ draft, setDraft, readOnly, showCustom, onReset }: { draft: Draft; setDraft: (d: Draft) => void; readOnly: boolean; showCustom?: boolean; onReset?: (p: Param) => void }) {
  return (
    <div className="divide-y divide-navy-50">
      {PARAMS.map((p) => {
        const d = draft[p];
        const m = PARAM_META[p];
        const low = d.low === "" ? null : Number(d.low);
        const high = d.high === "" ? null : Number(d.high);
        const invalid = low !== null && high !== null && low >= high;
        return (
          <div key={p} className="grid grid-cols-[1fr_auto] items-center gap-3 px-5 py-3 sm:grid-cols-[220px_1fr_1fr_auto_auto]">
            <div>
              <div className="font-semibold" style={{ color: m.color }}>{m.label}</div>
              <div className="text-xs text-navy-500">{m.unit}{showCustom && d.custom && <Badge tone="cyan" className="ml-2">custom</Badge>}</div>
            </div>
            <label className="text-xs text-navy-500">
              Low
              <Input type="number" className="tabular mt-0.5 text-lg font-bold" value={d.low} disabled={readOnly || !d.enabled} onChange={(e) => setDraft({ ...draft, [p]: { ...d, low: e.target.value } })} aria-invalid={invalid} />
            </label>
            <label className="text-xs text-navy-500">
              High
              <Input type="number" className="tabular mt-0.5 text-lg font-bold" value={d.high} disabled={readOnly || !d.enabled} onChange={(e) => setDraft({ ...draft, [p]: { ...d, high: e.target.value } })} aria-invalid={invalid} />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-navy-900" checked={d.enabled} disabled={readOnly} onChange={(e) => setDraft({ ...draft, [p]: { ...d, enabled: e.target.checked } })} />
              Alarm on
            </label>
            <div className="w-24 text-right">
              {invalid && <span className="text-xs font-semibold text-red-600">Low ≥ high</span>}
              {showCustom && d.custom && !readOnly && onReset && (
                <button className="inline-flex items-center gap-1 text-xs font-semibold text-navy-600 hover:underline" onClick={() => onReset(p)}>
                  <RotateCcw className="size-3" /> Default
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const toInputs = (d: Draft, only?: (p: Param) => boolean): LimitInput[] =>
  PARAMS.filter((p) => !only || only(p)).map((p) => ({ parameter: p, low: d[p].low === "" ? null : Number(d[p].low), high: d[p].high === "" ? null : Number(d[p].high), enabled: d[p].enabled }));

export default function ThresholdsPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const patientId = sp.get("patient") ?? "";
  const readOnly = !can.editLimits(profile?.role);
  const list = useQuery({ queryKey: ["thresholds"], queryFn: thresholdService.list });
  const patients = useQuery({ queryKey: ["patients"], queryFn: () => clinicalService.patients() });
  const patient = useQuery({ queryKey: ["patient", patientId], queryFn: () => clinicalService.patient(patientId), enabled: !!patientId });
  const [defaults, setDefaults] = useState<Draft | null>(null);
  const [pdraft, setPdraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (!list.data) return;
    const d = {} as Draft;
    PARAMS.forEach((p) => {
      const t = list.data.defaults.find((x) => x.parameter === p);
      d[p] = { low: t?.low?.toString() ?? "", high: t?.high?.toString() ?? "", enabled: t?.enabled ?? false, custom: false };
    });
    setDefaults(d);
  }, [list.data]);
  useEffect(() => {
    if (!patient.data) return setPdraft(null);
    const d = {} as Draft;
    PARAMS.forEach((p) => {
      const l = patient.data.limits[p];
      d[p] = { low: l.low?.toString() ?? "", high: l.high?.toString() ?? "", enabled: l.enabled, custom: !!l.custom };
    });
    setPdraft(d);
  }, [patient.data]);

  const refresh = () => ["thresholds", "patient"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const saveDefaults = useMutation({ mutationFn: () => thresholdService.setDefaults(toInputs(defaults!)), onSuccess: () => { toast.success("Unit defaults saved — applied from the next reading"); refresh(); }, onError: (e) => toast.error(errorMessage(e)) });
  const savePatient = useMutation({
    mutationFn: () => {
      const orig = patient.data!.limits;
      const changed = (p: Param) => {
        const d = pdraft![p];
        return d.custom || String(orig[p].low ?? "") !== d.low || String(orig[p].high ?? "") !== d.high || orig[p].enabled !== d.enabled;
      };
      const items = toInputs(pdraft!, changed);
      if (!items.length) throw new Error("No changes to save");
      return thresholdService.setPatient(patientId, items);
    },
    onSuccess: () => { toast.success("Patient limits saved"); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const resetParam = useMutation({ mutationFn: (p: Param) => thresholdService.resetPatient(patientId, p), onSuccess: () => { toast.success("Reverted to unit default"); refresh(); }, onError: (e) => toast.error(errorMessage(e)) });

  if (list.isLoading || !defaults) return list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : <PageLoader />;

  return (
    <div>
      <PageHeader title="Alarm limits" subtitle={readOnly ? "View only — physicians and administrators can change limits." : "Unit defaults apply to every patient unless a patient-specific limit is set."} />
      <div className="grid gap-6 2xl:grid-cols-2">
        <Card>
          <CardHeader title="Unit default limits" subtitle="Applied to all monitored patients" action={!readOnly && <Button size="sm" icon={<Save className="size-4" />} loading={saveDefaults.isPending} onClick={() => saveDefaults.mutate()}>Save defaults</Button>} />
          <LimitEditor draft={defaults} setDraft={setDefaults} readOnly={readOnly} />
        </Card>
        <Card>
          <CardHeader
            title="Patient-specific limits"
            subtitle="Override the defaults for one patient (e.g. COPD target SpO₂ 88–92%)"
            action={pdraft && !readOnly && <Button size="sm" icon={<Save className="size-4" />} loading={savePatient.isPending} onClick={() => savePatient.mutate()}>Save for patient</Button>}
          />
          <div className="border-b border-navy-100 px-5 py-3">
            <Select value={patientId} onChange={(e) => setSp(e.target.value ? { patient: e.target.value } : {}, { replace: true })} aria-label="Patient">
              <option value="">Select a patient…</option>
              {patients.data?.map((p) => <option key={p.id} value={p.id}>{p.bed?.label ?? "—"} · {p.last_name}, {p.first_name}</option>)}
            </Select>
          </div>
          {patientId && !pdraft ? (
            <PageLoader />
          ) : pdraft ? (
            <LimitEditor draft={pdraft} setDraft={setPdraft} readOnly={readOnly} showCustom onReset={(p) => resetParam.mutate(p)} />
          ) : (
            <div className="px-5 py-6">
              <div className="mb-2 text-sm font-semibold">Patients with custom limits</div>
              {list.data!.patients.length ? (
                <ul className="space-y-1.5">
                  {list.data!.patients.map((p) => (
                    <li key={p.patient_id}>
                      <button className="text-sm text-navy-800 hover:underline" onClick={() => setSp({ patient: p.patient_id })}>
                        <b>{p.bed}</b> · {p.patient_name} — {p.limits.map((l) => `${PARAM_META[l.parameter].short} ${l.low ?? "–"}/${l.high ?? "–"}`).join(", ")}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-navy-500">No patient-specific limits.</p>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
