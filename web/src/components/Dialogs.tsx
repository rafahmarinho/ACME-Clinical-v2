import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "../lib/api";
import { ALARM_TYPE_LABEL, duration } from "../lib/format";
import { alarmService } from "../services/alarms";
import { clinicalService } from "../services/clinical";
import { deviceService } from "../services/devices";
import type { Alarm, MonitorBrief } from "../types";
import { Button, Field, Modal, Select, Spinner, Textarea } from "./ui";
import { PriorityChip } from "./vitals/Vitals";

const QUICK_NOTES = ["Patient assessed at bedside", "Probe repositioned", "Physician notified", "Device checked"];

export function AckAlarmDialog({ alarm, onClose }: { alarm: Alarm | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const m = useMutation({
    mutationFn: () => alarmService.acknowledge(alarm!.id, note),
    onSuccess: () => {
      toast.success(alarm?.state === "active" ? "Alarm acknowledged — it stays active until the condition resolves" : "Alarm acknowledged");
      qc.invalidateQueries({ queryKey: ["alarms"] });
      qc.invalidateQueries({ queryKey: ["alarm-counts"] });
      qc.invalidateQueries({ queryKey: ["patient-alarms"] });
      qc.invalidateQueries({ queryKey: ["live"] });
      qc.invalidateQueries({ queryKey: ["wards"] });
      setNote("");
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal
      open={!!alarm}
      onClose={onClose}
      title="Acknowledge alarm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => m.mutate()} loading={m.isPending}>
            Acknowledge
          </Button>
        </>
      }
    >
      {alarm && (
        <div className="space-y-4">
          <div className="rounded-lg border border-navy-100 bg-navy-50/40 p-3">
            <div className="flex items-center gap-2">
              <PriorityChip priority={alarm.priority}>{ALARM_TYPE_LABEL[alarm.type] ?? alarm.type}</PriorityChip>
              <span className="text-sm font-semibold">{alarm.bed?.label}</span>
              <span className="text-sm text-navy-600">{alarm.patient?.full_name}</span>
            </div>
            <p className="mt-2 text-sm text-navy-800">{alarm.message}</p>
            <p className="mt-1 text-xs text-navy-500">Active for {duration(alarm.started_at, alarm.cleared_at)}</p>
          </div>
          {alarm.state === "active" && (
            <div className="flex gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              <Info className="mt-0.5 size-4 shrink-0" />
              Acknowledging records your response and silences the alert. The alarm remains active until the monitor reports that the
              condition has resolved.
            </div>
          )}
          <Field label="Response note (optional)">
            <Textarea rows={3} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="What did you do?" />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_NOTES.map((q) => (
              <button key={q} type="button" onClick={() => setNote(q)} className="focus-ring rounded-full bg-navy-50 px-2.5 py-1 text-xs font-medium text-navy-700 hover:bg-navy-100">
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

export function BindMonitorDialog({ monitor, onClose }: { monitor: MonitorBrief | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [bedId, setBedId] = useState("");
  const beds = useQuery({ queryKey: ["beds", "free"], queryFn: () => clinicalService.beds(true), enabled: !!monitor });
  const done = (msg: string) => {
    toast.success(msg);
    ["monitors", "monitor", "live", "wards", "patients", "patient", "beds", "simulation"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    setBedId("");
    onClose();
  };
  const bind = useMutation({
    mutationFn: () => deviceService.bind(monitor!.id, bedId),
    onSuccess: () => done(`${monitor?.asset_tag} linked to bed`),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const unbind = useMutation({
    mutationFn: () => deviceService.bind(monitor!.id, null),
    onSuccess: () => done(`${monitor?.asset_tag} unlinked`),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const linked = !!monitor?.bed_id;
  return (
    <Modal
      open={!!monitor}
      onClose={onClose}
      title={linked ? `Unlink ${monitor?.asset_tag}` : `Link ${monitor?.asset_tag} to a bed`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {linked ? (
            <Button variant="danger" loading={unbind.isPending} onClick={() => unbind.mutate()}>
              Unlink monitor
            </Button>
          ) : (
            <Button disabled={!bedId} loading={bind.isPending} onClick={() => bind.mutate()}>
              Link to bed
            </Button>
          )}
        </>
      }
    >
      {linked ? (
        <p className="text-sm text-navy-700">
          Monitoring for this bed will stop. Active alarms from this monitor will be closed and the monitor returns to the available pool.
        </p>
      ) : beds.isLoading ? (
        <Spinner />
      ) : (
        <Field label="Bed" hint="Only beds without a monitor are listed. Occupied beds show the patient name.">
          <Select value={bedId} onChange={(e) => setBedId(e.target.value)}>
            <option value="">Select a bed…</option>
            {beds.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label} — {b.ward_name} {b.patient ? `· ${b.patient.full_name}` : "· empty"}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </Modal>
  );
}
