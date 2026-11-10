import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Avatar } from "../components/layout/AppShell";
import { Badge, Button, Card, EmptyState, ErrorState, Field, FilterBar, Input, Modal, PageHeader, Select, Skeleton, StatCard, Table, Td, Th } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { errorMessage } from "../lib/api";
import { fmtDate } from "../lib/format";
import { ROLE_LABEL } from "../lib/roles";
import { teamService } from "../services/admin";
import type { Role, StaffMember } from "../types";

const ROLES: Role[] = ["nurse", "physician", "biomed", "admin"];

function CreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const empty = { email: "", full_name: "", role: "nurse", title: "", password: "" };
  const [f, setF] = useState(empty);
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => teamService.create({ ...f, title: f.title || undefined }),
    onSuccess: () => { toast.success("Account created — welcome e-mail sent (simulated)"); qc.invalidateQueries({ queryKey: ["team"] }); setF(empty); onClose(); },
    onError: (e) => setErr(errorMessage(e)),
  });
  const submit = () => {
    if (f.full_name.trim().length < 2) return setErr("Enter the full name.");
    if (!/^\S+@\S+\.\S{2,}$/.test(f.email)) return setErr("Enter a valid e-mail.");
    if (f.password.length < 8 || !/\d/.test(f.password) || !/[a-z]/i.test(f.password)) return setErr("Temporary password: 8+ characters with letters and numbers.");
    setErr(null);
    m.mutate();
  };
  return (
    <Modal open={open} onClose={onClose} title="Add staff member" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={submit}>Create account</Button></>}>
      <div className="space-y-4">
        <Field label="Full name"><Input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
        <Field label="E-mail"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role"><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select></Field>
          <Field label="Job title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. RN, ICU" /></Field>
        </div>
        <Field label="Temporary password" hint="Share it securely; the user can change it from their profile."><Input type="text" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700" role="alert">{err}</div>}
      </div>
    </Modal>
  );
}

export default function TeamPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(false);
  const list = useQuery({ queryKey: ["team", role, status], queryFn: () => teamService.list({ role: role || undefined, active: status ? status === "active" : undefined }) });
  const upd = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof teamService.update>[1] }) => teamService.update(id, body),
    onSuccess: () => { toast.success("Staff member updated"); qc.invalidateQueries({ queryKey: ["team"] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rows = (list.data ?? []).filter((s) => !q || `${s.full_name} ${s.email} ${s.title ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const all = list.data ?? [];

  return (
    <div>
      <PageHeader title="Team" subtitle="Staff accounts, roles and access" actions={<Button icon={<UserPlus className="size-4" />} onClick={() => setOpen(true)}>Add staff member</Button>} />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {ROLES.map((r) => <StatCard key={r} label={ROLE_LABEL[r]} value={all.filter((s) => s.role === r && s.is_active).length} />)}
      </div>
      <FilterBar>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-navy-400" />
          <Input className="pl-9" placeholder="Name, e-mail or title" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search staff" />
        </div>
        <Select className="w-auto" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role"><option value="">All roles</option>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select>
        <Select className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">Active & inactive</option><option value="active">Active</option><option value="inactive">Deactivated</option></Select>
      </FilterBar>
      <Card>
        {list.isLoading ? <div className="space-y-2 p-4">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div> : list.error ? <div className="p-4"><ErrorState error={list.error} onRetry={() => list.refetch()} /></div> : !rows.length ? <EmptyState title="No staff found" /> : (
          <Table>
            <thead><tr><Th>Name</Th><Th>Role</Th><Th>Title</Th><Th>Status</Th><Th>Since</Th><Th /></tr></thead>
            <tbody>
              {rows.map((s: StaffMember) => {
                const self = s.id === profile?.id;
                return (
                  <tr key={s.id} className="hover:bg-navy-50/40">
                    <Td>
                      <div className="flex items-center gap-3">
                        <Avatar name={s.full_name} url={s.avatar_url} />
                        <div><div className="font-semibold">{s.full_name}{self && <span className="ml-1 text-xs text-navy-400">(you)</span>}</div><div className="text-xs text-navy-500">{s.email}</div></div>
                      </div>
                    </Td>
                    <Td>
                      <Select className="h-9 w-48" value={s.role} disabled={self || upd.isPending} onChange={(e) => upd.mutate({ id: s.id, body: { role: e.target.value } })} aria-label={`Role for ${s.full_name}`}>
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </Select>
                    </Td>
                    <Td className="text-navy-600">{s.title ?? "—"}</Td>
                    <Td>{s.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Deactivated</Badge>}</Td>
                    <Td className="text-xs">{fmtDate(s.created_at)}</Td>
                    <Td className="text-right">
                      {!self && (
                        <Button size="sm" variant={s.is_active ? "secondary" : "success"} onClick={() => upd.mutate({ id: s.id, body: { is_active: !s.is_active } })}>
                          {s.is_active ? "Deactivate" : "Reactivate"}
                        </Button>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <CreateDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
