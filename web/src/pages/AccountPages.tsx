import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, KeyRound, Save } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Avatar } from "../components/layout/AppShell";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, PageHeader, PageLoader, Select, Toggle } from "../components/ui";
import { DeviceStatus } from "../components/vitals/Vitals";
import { useAuth } from "../context/AuthContext";
import { errorMessage } from "../lib/api";
import { ROLE_LABEL } from "../lib/roles";
import { supabase } from "../lib/supabase";
import { profileService } from "../services/admin";
import { clinicalService } from "../services/clinical";
import type { Preferences, SystemSettings } from "../types";

export function ProfilePage() {
  const { profile, refreshProfile } = useAuth();
  const [f, setF] = useState({ full_name: "", title: "", phone: "" });
  const [pw, setPw] = useState({ next: "", confirm: "" });
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (profile) setF({ full_name: profile.full_name, title: profile.title ?? "", phone: profile.phone ?? "" });
  }, [profile]);
  const save = useMutation({
    mutationFn: () => profileService.update({ full_name: f.full_name.trim(), title: f.title || null, phone: f.phone || null }),
    onSuccess: () => { toast.success("Profile saved"); refreshProfile(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const changePw = useMutation({
    mutationFn: async () => {
      if (pw.next.length < 8) throw new Error("Use at least 8 characters.");
      if (pw.next !== pw.confirm) throw new Error("Passwords do not match.");
      const { error } = await supabase.auth.updateUser({ password: pw.next });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Password changed"); setPw({ next: "", confirm: "" }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const upload = async (file: File) => {
    if (!profile) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return toast.error("Use a PNG, JPEG or WebP image.");
    if (file.size > 2 * 1024 * 1024) return toast.error("Image must be 2 MB or smaller.");
    setUploading(true);
    try {
      const path = `${profile.id}/avatar-${Date.now()}.${file.type.split("/")[1]}`;
      const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      const url = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
      await profileService.update({ avatar_url: url });
      refreshProfile();
      toast.success("Photo updated");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setUploading(false);
    }
  };
  if (!profile) return <PageLoader />;
  return (
    <div className="max-w-3xl">
      <PageHeader title="My profile" subtitle="Your details as shown to colleagues" />
      <Card className="mb-6">
        <div className="flex flex-wrap items-center gap-5 border-b border-navy-100 p-5">
          <div className="relative">
            <Avatar name={profile.full_name || profile.email} url={profile.avatar_url} size={80} />
            <button onClick={() => fileRef.current?.click()} className="focus-ring absolute -bottom-1 -right-1 rounded-full bg-navy-900 p-2 text-white shadow" aria-label="Change photo" disabled={uploading}>
              <Camera className="size-4" />
            </button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </div>
          <div>
            <div className="text-xl font-bold">{profile.full_name}</div>
            <div className="text-sm text-navy-500">{profile.email}</div>
            <Badge className="mt-1.5">{ROLE_LABEL[profile.role]}</Badge>
            {uploading && <div className="mt-1 text-xs text-navy-500">Uploading photo…</div>}
          </div>
        </div>
        <form className="grid gap-4 p-5 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (f.full_name.trim().length < 2) return toast.error("Enter your full name."); save.mutate(); }}>
          <Field label="Full name" className="sm:col-span-2"><Input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
          <Field label="Job title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Phone / extension"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <div className="sm:col-span-2 flex justify-end"><Button type="submit" loading={save.isPending} icon={<Save className="size-4" />}>Save profile</Button></div>
        </form>
      </Card>
      <Card>
        <CardHeader title="Change password" />
        <form className="grid gap-4 p-5 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); changePw.mutate(); }}>
          <Field label="New password"><Input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
          <Field label="Confirm new password"><Input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
          <div className="sm:col-span-2 flex justify-end"><Button type="submit" variant="secondary" loading={changePw.isPending} icon={<KeyRound className="size-4" />}>Update password</Button></div>
        </form>
      </Card>
    </div>
  );
}

function Section({ title, subtitle, children, action }: { title: string; subtitle?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Card className="mb-6">
      <CardHeader title={title} subtitle={subtitle} action={action} />
      <div className="divide-y divide-navy-50 px-5">{children}</div>
    </Card>
  );
}

export function SettingsPage() {
  const { profile, refreshProfile } = useAuth();
  const qc = useQueryClient();
  const [p, setP] = useState<Preferences | null>(null);
  const [s, setS] = useState<SystemSettings | null>(null);
  const wards = useQuery({ queryKey: ["wards"], queryFn: clinicalService.wardOverview });
  const sys = useQuery({ queryKey: ["system-settings"], queryFn: profileService.systemSettings });
  useEffect(() => { if (profile) setP(profile.preferences); }, [profile]);
  useEffect(() => { if (sys.data) setS(sys.data); }, [sys.data]);
  const savePrefs = useMutation({ mutationFn: () => profileService.savePreferences(p!), onSuccess: () => { toast.success("Preferences saved"); refreshProfile(); }, onError: (e) => toast.error(errorMessage(e)) });
  const saveSys = useMutation({ mutationFn: () => profileService.saveSystemSettings(s!), onSuccess: () => { toast.success("System settings saved"); qc.invalidateQueries({ queryKey: ["system-settings"] }); }, onError: (e) => toast.error(errorMessage(e)) });
  if (!p) return <PageLoader />;
  const isAdmin = profile?.role === "admin";
  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" subtitle="Personal preferences are saved to your account and follow you on any device." />
      <Section title="Alarms & notifications" action={<Button size="sm" loading={savePrefs.isPending} onClick={() => savePrefs.mutate()}>Save preferences</Button>}>
        <Toggle label="Audible alarm tone" description="Plays a tone while high-priority alarms are unacknowledged" checked={p.alarm_sound} onChange={(v) => setP({ ...p, alarm_sound: v })} />
        <div className="flex items-center justify-between gap-4 py-3">
          <div><div className="text-sm font-medium">Alarm volume</div><div className="text-sm text-navy-500">{p.alarm_volume}%</div></div>
          <input type="range" min={0} max={100} value={p.alarm_volume} onChange={(e) => setP({ ...p, alarm_volume: Number(e.target.value) })} className="w-48 accent-navy-900" aria-label="Alarm volume" />
        </div>
        <Toggle label="Highlight high-priority alarms" description="Flash bed tiles and the alarm counter" checked={p.notify_high_priority} onChange={(v) => setP({ ...p, notify_high_priority: v })} />
        <Toggle label="Show technical alarms" description="Battery, sensor and connection alerts" checked={p.notify_technical} onChange={(v) => setP({ ...p, notify_technical: v })} />
      </Section>
      <Section title="Display">
        <Toggle label="Show ECG waveforms" checked={p.show_ecg} onChange={(v) => setP({ ...p, show_ecg: v })} />
        <Toggle label="Compact monitor tiles" description="Fit more beds on the live monitoring screen" checked={p.compact_tiles} onChange={(v) => setP({ ...p, compact_tiles: v })} />
        <div className="grid gap-4 py-3 sm:grid-cols-2">
          <Field label="Default ward">
            <Select value={p.default_ward_id ?? ""} onChange={(e) => setP({ ...p, default_ward_id: e.target.value || null })}>
              <option value="">First ward</option>
              {wards.data?.wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
          <Field label="Default trend window">
            <Select value={p.trend_window_minutes} onChange={(e) => setP({ ...p, trend_window_minutes: Number(e.target.value) })}>
              {[15, 30, 60, 120].map((m) => <option key={m} value={m}>{m} minutes</option>)}
            </Select>
          </Field>
        </div>
      </Section>
      {s && (
        <Section title="System" subtitle={isAdmin ? "Facility-wide settings" : "Facility-wide settings (administrators only)"} action={isAdmin && <Button size="sm" loading={saveSys.isPending} onClick={() => saveSys.mutate()}>Save system settings</Button>}>
          <div className="grid gap-4 py-3 sm:grid-cols-2">
            <Field label="Facility name"><Input value={s.facility_name} disabled={!isAdmin} onChange={(e) => setS({ ...s, facility_name: e.target.value })} /></Field>
            <Field label="Battery low threshold (%)"><Input type="number" min={5} max={50} value={s.battery_low_threshold} disabled={!isAdmin} onChange={(e) => setS({ ...s, battery_low_threshold: Number(e.target.value) })} /></Field>
            <Field label="Escalation after (minutes)" hint="Unacknowledged high-priority alarms escalate to the charge nurse"><Input type="number" min={1} max={60} value={s.escalation_minutes} disabled={!isAdmin} onChange={(e) => setS({ ...s, escalation_minutes: Number(e.target.value) })} /></Field>
            <Field label="History retention (hours)"><Input type="number" min={6} max={720} value={s.history_retention_hours} disabled={!isAdmin} onChange={(e) => setS({ ...s, history_retention_hours: Number(e.target.value) })} /></Field>
          </div>
          <Toggle label="Pager integration (simulated)" description="Send high-priority alarms to the charge nurse pager gateway" checked={s.paging_enabled} disabled={!isAdmin} onChange={(v) => setS({ ...s, paging_enabled: v })} />
        </Section>
      )}
      {sys.error && <ErrorState error={sys.error} />}
    </div>
  );
}

export function SearchPage() {
  const [sp] = useSearchParams();
  const term = sp.get("q") ?? "";
  const q = useQuery({ queryKey: ["search", term], queryFn: () => clinicalService.search(term), enabled: term.length >= 2 });
  if (term.length < 2) return <EmptyState title="Type at least 2 characters to search" />;
  if (q.isLoading) return <PageLoader label="Searching…" />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data!;
  const none = !r.patients.length && !r.monitors.length && !r.beds.length;
  return (
    <div>
      <PageHeader title={`Results for “${term}”`} />
      {none ? <EmptyState title="Nothing found" description="Search by patient name, MRN, diagnosis, bed label, asset tag or serial number." /> : (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card><CardHeader title={`Patients (${r.patients.length})`} />
            <ul className="divide-y divide-navy-50">{r.patients.map((p) => <li key={p.id}><Link to={`/patients/${p.id}`} className="block px-5 py-3 hover:bg-navy-50/50"><div className="font-semibold">{p.full_name}</div><div className="text-xs text-navy-500">{p.mrn} · {p.bed?.label ?? "no bed"} · {p.diagnosis}</div></Link></li>)}</ul>
          </Card>
          <Card><CardHeader title={`Monitors (${r.monitors.length})`} />
            <ul className="divide-y divide-navy-50">{r.monitors.map((m) => <li key={m.id}><Link to={`/devices/${m.id}`} className="block px-5 py-3 hover:bg-navy-50/50"><div className="flex justify-between"><span className="font-semibold">{m.asset_tag}</span><DeviceStatus monitor={m} /></div><div className="text-xs text-navy-500">{m.model} · {m.bed?.label ?? "unassigned"}</div></Link></li>)}</ul>
          </Card>
          <Card><CardHeader title={`Beds (${r.beds.length})`} />
            <ul className="divide-y divide-navy-50">{r.beds.map((b) => <li key={b.id} className="px-5 py-3">{b.patient ? <Link to={`/patients/${b.patient.id}`} className="hover:underline"><b>{b.label}</b> · {b.patient.full_name}</Link> : <span><b>{b.label}</b> · available</span>}<div className="text-xs text-navy-500">{b.ward_name}</div></li>)}</ul>
          </Card>
        </div>
      )}
    </div>
  );
}

export function NotFoundPage({ forbidden = false }: { forbidden?: boolean }) {
  return (
    <EmptyState
      title={forbidden ? "You don’t have access to this page" : "Page not found"}
      description={forbidden ? "Your role does not include this area. Contact an administrator if you need access." : "The page you’re looking for doesn’t exist or was moved."}
      action={<Link to="/" className="mt-2"><Button>Go to my home page</Button></Link>}
    />
  );
}
