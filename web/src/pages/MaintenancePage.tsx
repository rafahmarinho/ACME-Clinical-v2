import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Paperclip, Plus, Upload, Wrench } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Badge, Button, Card, EmptyState, ErrorState, Field, FilterBar, Input, Modal, PageHeader, Select, Skeleton, StatCard, Table, Td, Textarea, Th } from "../components/ui";
import { errorMessage } from "../lib/api";
import { fmtDate, titleCase } from "../lib/format";
import { deviceService } from "../services/devices";
import type { MaintenanceRecord } from "../types";

const TYPES = ["preventive", "corrective", "calibration", "battery_replacement", "inspection"];

export function MaintenanceStatusBadge({ status }: { status: MaintenanceRecord["status"] }) {
  const tone = { scheduled: "navy", in_progress: "amber", completed: "green", cancelled: "gray" } as const;
  return <Badge tone={tone[status]}>{titleCase(status)}</Badge>;
}

export function MaintenanceForm({ open, onClose, monitorId }: { open: boolean; onClose: () => void; monitorId?: string }) {
  const qc = useQueryClient();
  const monitors = useQuery({ queryKey: ["monitors"], queryFn: () => deviceService.list(), enabled: open && !monitorId });
  const [form, setForm] = useState({ monitor_id: "", type: "preventive", scheduled_for: new Date().toISOString().slice(0, 10), description: "" });
  const m = useMutation({
    mutationFn: () => deviceService.createMaintenance({ ...form, monitor_id: monitorId ?? form.monitor_id }),
    onSuccess: () => {
      toast.success("Maintenance scheduled");
      qc.invalidateQueries({ queryKey: ["maintenance"] });
      qc.invalidateQueries({ queryKey: ["monitors"] });
      setForm((f) => ({ ...f, description: "" }));
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const valid = (monitorId || form.monitor_id) && form.description.trim().length >= 3 && form.scheduled_for;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Schedule maintenance"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid} loading={m.isPending} onClick={() => m.mutate()}>Schedule</Button>
        </>
      }
    >
      <div className="space-y-4">
        {!monitorId && (
          <Field label="Monitor">
            <Select value={form.monitor_id} onChange={(e) => setForm({ ...form, monitor_id: e.target.value })}>
              <option value="">Select a monitor…</option>
              {monitors.data?.map((mo) => (
                <option key={mo.id} value={mo.id}>{mo.asset_tag} · {mo.model} {mo.bed ? `(${mo.bed.label})` : ""}</option>
              ))}
            </Select>
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type">
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
            </Select>
          </Field>
          <Field label="Scheduled for">
            <Input type="date" value={form.scheduled_for} onChange={(e) => setForm({ ...form, scheduled_for: e.target.value })} />
          </Field>
        </div>
        <Field label="Description">
          <Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What needs to be done?" />
        </Field>
      </div>
    </Modal>
  );
}

function UpdateDialog({ record, onClose }: { record: MaintenanceRecord | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>("");
  const [resolution, setResolution] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const refresh = () => ["maintenance", "monitors", "monitor"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const save = useMutation({
    mutationFn: () => deviceService.updateMaintenance(record!.id, { status: status || record!.status, resolution: resolution || undefined }),
    onSuccess: () => { toast.success("Work order updated"); refresh(); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const upload = useMutation({
    mutationFn: (f: File) => deviceService.uploadAttachment(record!.id, f),
    onSuccess: () => { toast.success("Document attached"); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!record) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title={`${titleCase(record.type)} · ${record.monitor?.asset_tag ?? ""}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>Save changes</Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-navy-700">{record.description}</p>
        <Field label="Status">
          <Select value={status || record.status} onChange={(e) => setStatus(e.target.value)}>
            {["scheduled", "in_progress", "completed", "cancelled"].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </Select>
        </Field>
        <Field label="Resolution / technician notes">
          <Textarea rows={3} defaultValue={record.resolution ?? ""} onChange={(e) => setResolution(e.target.value)} />
        </Field>
        <div className="flex items-center gap-3 rounded-lg border border-dashed border-navy-200 p-3">
          <Paperclip className="size-4 text-navy-500" />
          <div className="flex-1 text-sm">
            {record.attachment_path ? (
              <button
                className="font-semibold text-navy-800 hover:underline"
                onClick={async () => {
                  try { window.open((await deviceService.attachmentUrl(record.id)).url, "_blank", "noopener"); } catch (e) { toast.error(errorMessage(e)); }
                }}
              >
                {record.attachment_path.split("/").pop()}
              </button>
            ) : (
              <span className="text-navy-500">No service document attached</span>
            )}
          </div>
          <input ref={file} type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.txt,.csv" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
          <Button size="sm" variant="secondary" loading={upload.isPending} icon={<Upload className="size-4" />} onClick={() => file.current?.click()}>Upload</Button>
        </div>
      </div>
    </Modal>
  );
}

export default function MaintenancePage() {
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [create, setCreate] = useState(false);
  const [edit, setEdit] = useState<MaintenanceRecord | null>(null);
  const q = useQuery({ queryKey: ["maintenance", status, type], queryFn: () => deviceService.maintenance({ status: status || undefined, type: type || undefined }) });
  const all = useQuery({ queryKey: ["maintenance", "all"], queryFn: () => deviceService.maintenance() });
  const today = new Date().toISOString().slice(0, 10);
  const open = (all.data ?? []).filter((r) => r.status === "scheduled" || r.status === "in_progress");

  return (
    <div>
      <PageHeader title="Maintenance" subtitle="Preventive maintenance, repairs and calibration for patient monitors" actions={<Button icon={<Plus className="size-4" />} onClick={() => setCreate(true)}>Schedule maintenance</Button>} />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Open work orders" value={open.length} icon={<Wrench className="size-4" />} />
        <StatCard label="In progress" value={open.filter((r) => r.status === "in_progress").length} tone="amber" />
        <StatCard label="Overdue" value={open.filter((r) => r.scheduled_for < today).length} tone="red" icon={<CalendarClock className="size-4" />} />
        <StatCard label="Completed (all time)" value={(all.data ?? []).filter((r) => r.status === "completed").length} tone="green" />
      </div>
      <FilterBar>
        <Select className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {["scheduled", "in_progress", "completed", "cancelled"].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
        </Select>
        <Select className="w-auto" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
          <option value="">All types</option>
          {TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
        </Select>
      </FilterBar>
      <Card>
        {q.isLoading ? (
          <div className="space-y-2 p-4">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : q.error ? (
          <div className="p-4"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>
        ) : !q.data?.length ? (
          <EmptyState title="No work orders" description="Schedule maintenance to start tracking it here." />
        ) : (
          <Table>
            <thead>
              <tr><Th>Scheduled</Th><Th>Monitor</Th><Th>Type</Th><Th>Description</Th><Th>Status</Th><Th>Technician</Th><Th /></tr>
            </thead>
            <tbody>
              {q.data.map((r) => (
                <tr key={r.id} className="hover:bg-navy-50/40">
                  <Td className={(r.status === "scheduled" || r.status === "in_progress") && r.scheduled_for < today ? "font-semibold text-red-600" : ""}>{fmtDate(r.scheduled_for)}</Td>
                  <Td><Link to={`/devices/${r.monitor_id}`} className="font-bold hover:underline">{r.monitor?.asset_tag}</Link><div className="text-xs text-navy-500">{r.monitor?.model}</div></Td>
                  <Td>{titleCase(r.type)}</Td>
                  <Td className="max-w-md">
                    <div className="truncate">{r.description}</div>
                    {r.resolution && <div className="truncate text-xs text-navy-500">{r.resolution}</div>}
                  </Td>
                  <Td><MaintenanceStatusBadge status={r.status} />{r.attachment_path && <Paperclip className="ml-1 inline size-3.5 text-navy-400" />}</Td>
                  <Td className="text-xs">{r.technician_name ?? "—"}</Td>
                  <Td className="text-right"><Button size="sm" variant="secondary" onClick={() => setEdit(r)}>Update</Button></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <MaintenanceForm open={create} onClose={() => setCreate(false)} />
      <UpdateDialog key={edit?.id} record={edit} onClose={() => setEdit(null)} />
    </div>
  );
}
