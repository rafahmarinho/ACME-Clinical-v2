import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { BellRing, ChevronDown, LogOut, Menu, Search, Settings, UserRound, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useAuth } from "../../context/AuthContext";
import { useRealtimeSync } from "../../hooks/useRealtime";
import { useAlarmTone, useSimState, useSimulationDriver } from "../../hooks/useSimulation";
import { NAV, ROLE_LABEL } from "../../lib/roles";
import { alarmService } from "../../services/alarms";

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="7" fill={light ? "#ffffff" : "#0B1F44"} />
        <path d="M4 17h6l2.5-6 4 12 3-9 2 3H28" fill="none" stroke={light ? "#0B1F44" : "#5EEAD4"} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="leading-tight">
        <div className={clsx("text-[15px] font-extrabold tracking-tight", light ? "text-white" : "text-navy-900")}>ACME Clinical</div>
        <div className={clsx("text-[11px] font-medium", light ? "text-navy-200" : "text-navy-500")}>Central Station</div>
      </div>
    </div>
  );
}

export function Avatar({ name, url, size = 32 }: { name: string; url?: string | null; size?: number }) {
  const initials = name
    .replace(/^Dr\.?\s+/i, "")
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return url ? (
    <img src={url} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-navy-100 font-bold text-navy-700" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials || "?"}
    </span>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { profile } = useAuth();
  const items = NAV.filter((n) => profile && n.roles.includes(profile.role));
  const sections = ["Clinical", "Devices", "Administration"] as const;
  return (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-5" aria-label="Main">
      <div className="px-2">
        <Logo />
      </div>
      {sections.map((s) => {
        const list = items.filter((i) => i.section === s);
        if (!list.length) return null;
        return (
          <div key={s}>
            <div className="mb-1 px-3 text-[11px] font-bold uppercase tracking-wider text-navy-400">{s}</div>
            <ul className="space-y-0.5">
              {list.map((i) => (
                <li key={i.to}>
                  <NavLink
                    to={i.to}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      clsx(
                        "focus-ring flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
                        isActive ? "bg-navy-900 text-white" : "text-navy-700 hover:bg-navy-50",
                      )
                    }
                  >
                    <i.icon className="size-[18px]" />
                    {i.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <div className="mt-auto rounded-lg bg-navy-50 px-3 py-2.5 text-xs text-navy-600">
        Signed in as <span className="font-semibold text-navy-900">{profile ? ROLE_LABEL[profile.role] : ""}</span>
        <div className="mt-0.5 text-navy-400">Simulated devices · Fictitious patients</div>
      </div>
    </nav>
  );
}

function GlobalSearch() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  return (
    <form
      role="search"
      className="relative w-full max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim().length >= 2) nav(`/search?q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-navy-400" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search patients, MRN, beds, monitors…"
        aria-label="Search"
        className="focus-ring h-10 w-full rounded-lg border border-navy-100 bg-navy-50/60 pl-9 pr-3 text-sm placeholder:text-navy-400 focus:bg-white"
      />
    </form>
  );
}

function UserMenu() {
  const { profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  if (!profile) return null;
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="focus-ring flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-navy-50" aria-haspopup="menu" aria-expanded={open}>
        <Avatar name={profile.full_name || profile.email} url={profile.avatar_url} />
        <div className="hidden text-left leading-tight md:block">
          <div className="text-sm font-semibold text-navy-900">{profile.full_name}</div>
          <div className="text-xs text-navy-500">{ROLE_LABEL[profile.role]}</div>
        </div>
        <ChevronDown className="size-4 text-navy-400" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-56 overflow-hidden rounded-xl border border-navy-100 bg-white py-1 shadow-xl">
          <div className="border-b border-navy-50 px-4 py-2 text-xs text-navy-500">{profile.email}</div>
          <Link role="menuitem" to="/profile" onClick={() => setOpen(false)} className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-navy-50">
            <UserRound className="size-4" /> My profile
          </Link>
          <Link role="menuitem" to="/settings" onClick={() => setOpen(false)} className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-navy-50">
            <Settings className="size-4" /> Settings
          </Link>
          <button role="menuitem" onClick={() => signOut()} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50">
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function AppShell() {
  const { profile } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const loc = useLocation();
  const rt = useRealtimeSync(!!profile);
  const sim = useSimState(!!profile);
  useSimulationDriver(sim.data);
  const counts = useQuery({ queryKey: ["alarm-counts"], queryFn: alarmService.counts, refetchInterval: 20_000, enabled: !!profile });
  useAlarmTone(counts.data, profile?.preferences);
  useEffect(() => setMobileOpen(false), [loc.pathname]);

  const c = counts.data;
  return (
    <div className="flex min-h-screen bg-white">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-navy-100 bg-white lg:block">
        <Sidebar />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-navy-950/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-white shadow-xl">
            <button className="absolute right-3 top-4 rounded-md p-1 text-navy-500" onClick={() => setMobileOpen(false)} aria-label="Close menu">
              <X className="size-5" />
            </button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-navy-100 bg-white/95 px-4 backdrop-blur sm:px-6">
          <button className="rounded-md p-2 text-navy-700 hover:bg-navy-50 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <div className="hidden items-center gap-2 rounded-full bg-navy-50 px-3 py-1.5 text-xs font-semibold text-navy-700 md:flex" title="Realtime connection and simulation clock">
              <span className={clsx("size-2 rounded-full", rt === "live" ? "pulse-dot bg-emerald-500" : rt === "offline" ? "bg-red-500" : "bg-amber-400")} />
              {rt === "live" ? "Realtime" : rt === "offline" ? "Reconnecting" : "Connecting"}
              <span className="text-navy-300">|</span>
              {sim.data?.running ? <span className="text-emerald-700">Simulation running</span> : <span>Simulation paused</span>}
            </div>
            <Link
              to="/alarms"
              className={clsx(
                "focus-ring relative inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-bold",
                c?.high_unacknowledged ? "alarm-flash bg-red-600 text-white" : c?.unacknowledged ? "bg-amber-100 text-amber-900" : "bg-navy-50 text-navy-700",
              )}
              aria-label={`${c?.active ?? 0} active alarms`}
            >
              <BellRing className="size-4" />
              <span className="tabular">{c?.active ?? 0}</span>
              <span className="hidden sm:inline">{c?.unacknowledged ? `· ${c.unacknowledged} unack.` : "active"}</span>
            </Link>
            <UserMenu />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
