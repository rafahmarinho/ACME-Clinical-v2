import { ArrowLeft, CheckCircle2, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { toast } from "sonner";
import { Logo } from "../components/layout/AppShell";
import { Button, Field, Input } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { HOME } from "../lib/roles";
import { configError, supabase } from "../lib/supabase";

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-[1fr_minmax(0,560px)]">
      <div className="relative hidden overflow-hidden bg-navy-900 lg:block">
        <svg className="absolute inset-x-0 top-1/2 w-full -translate-y-1/2 opacity-30" viewBox="0 0 800 200" preserveAspectRatio="none" aria-hidden>
          <path d="M0 110 H180 L205 60 L230 150 L250 20 L272 180 L292 110 H470 L495 70 L520 140 L540 30 L562 170 L582 110 H800" fill="none" stroke="#5eead4" strokeWidth="3" />
        </svg>
        <div className="relative flex h-full flex-col justify-between p-12">
          <Logo light />
          <div>
            <h2 className="max-w-md text-4xl font-extrabold leading-tight text-white">Every bedside, one clear view.</h2>
            <p className="mt-4 max-w-md text-navy-200">
              Real-time vital signs, prioritized alarms and device health for every ward — built for nurses, physicians and biomedical teams.
            </p>
          </div>
          <p className="text-xs text-navy-300">Demonstration environment · Simulated monitors · Fictitious patient data</p>
        </div>
      </div>
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <h1 className="text-2xl font-bold text-navy-900">{title}</h1>
          <p className="mt-1 text-sm text-navy-500">{subtitle}</p>
          {configError && <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{configError}</div>}
          <div className="mt-8">{children}</div>
        </div>
      </div>
    </div>
  );
}

const DEMO = [
  ["Nurse", "nurse@acme-clinical.test"],
  ["Physician", "physician@acme-clinical.test"],
  ["Biomed", "biomed@acme-clinical.test"],
  ["Admin", "admin@acme-clinical.test"],
];

export function LoginPage() {
  const { session, profile } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  if (session && profile) return <Navigate to={HOME[profile.role]} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email || !password) return setError("Enter your e-mail and password.");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) setError(error.message === "Invalid login credentials" ? "Incorrect e-mail or password." : error.message);
  };

  return (
    <AuthLayout title="Sign in" subtitle="Use your hospital account to access the central station.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="E-mail">
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-navy-400" />
            <Input type="email" autoComplete="username" className="pl-9" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@hospital.org" />
          </div>
        </Field>
        <Field label="Password">
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-navy-400" />
            <Input type={show ? "text" : "password"} autoComplete="current-password" className="px-9" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-navy-400" aria-label={show ? "Hide password" : "Show password"}>
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </Field>
        {error && (
          <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            {error}
          </div>
        )}
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm font-semibold text-navy-700 hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" size="lg" className="w-full" loading={loading}>
          Sign in
        </Button>
      </form>
      <div className="mt-8 rounded-xl border border-dashed border-navy-200 p-4">
        <div className="text-xs font-bold uppercase tracking-wide text-navy-500">Demo accounts</div>
        <p className="mt-1 text-xs text-navy-500">Pick a role to fill the e-mail. The password is in the README.</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {DEMO.map(([role, mail]) => (
            <button key={mail} type="button" onClick={() => setEmail(mail)} className="focus-ring rounded-lg bg-navy-50 px-3 py-2 text-left text-xs font-semibold text-navy-800 hover:bg-navy-100">
              {role}
            </button>
          ))}
        </div>
      </div>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError("Enter a valid e-mail address.");
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` });
    setLoading(false);
    if (error) setError(error.message);
    else setSent(true);
  };
  return (
    <AuthLayout title="Reset your password" subtitle="We’ll e-mail you a secure link to choose a new password.">
      {sent ? (
        <div className="space-y-4">
          <div className="flex gap-3 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">
            <CheckCircle2 className="size-5 shrink-0" />
            If an account exists for {email}, a reset link is on its way. Check your inbox (local demo: Mailpit).
          </div>
          <Link to="/login" className="inline-flex items-center gap-1 text-sm font-semibold text-navy-700 hover:underline">
            <ArrowLeft className="size-4" /> Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="E-mail" error={error}>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={loading}>
            Send reset link
          </Button>
          <Link to="/login" className="inline-flex items-center gap-1 text-sm font-semibold text-navy-700 hover:underline">
            <ArrowLeft className="size-4" /> Back to sign in
          </Link>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const { session, clearRecovery } = useAuth();
  const nav = useNavigate();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) return setError("Use at least 8 characters.");
    if (pw !== pw2) return setError("Passwords do not match.");
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setLoading(false);
    if (error) return setError(error.message);
    clearRecovery();
    toast.success("Password updated");
    nav("/", { replace: true });
  };
  return (
    <AuthLayout title="Choose a new password" subtitle="Your new password must be at least 8 characters long.">
      {!session ? (
        <div className="space-y-4 text-sm text-navy-600">
          <p>This reset link is invalid or has expired. Request a new one to continue.</p>
          <Link to="/forgot-password" className="font-semibold text-navy-800 hover:underline">
            Request a new link
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="New password">
            <Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
          <Field label="Confirm new password" error={error}>
            <Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={loading}>
            Update password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
