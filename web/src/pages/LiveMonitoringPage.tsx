import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { useState } from "react";
import { EmptyState, ErrorState, PageHeader, Select, Skeleton, Tabs } from "../components/ui";
import { MonitorTile } from "../components/vitals/MonitorTile";
import { useAuth } from "../context/AuthContext";
import { useSimState } from "../hooks/useSimulation";
import { fmtTime } from "../lib/format";
import { clinicalService } from "../services/clinical";

export default function LiveMonitoringPage() {
  const { profile } = useAuth();
  const [ward, setWard] = useState("");
  const [sort, setSort] = useState<"bed" | "priority">("priority");
  const wards = useQuery({ queryKey: ["wards"], queryFn: clinicalService.wardOverview });
  const q = useQuery({ queryKey: ["live", ward], queryFn: () => clinicalService.live(ward || undefined), refetchInterval: 15_000 });
  const sim = useSimState();
  const rank = { high: 0, medium: 1, low: 2 } as const;
  const tiles = [...(q.data ?? [])].sort((a, b) =>
    sort === "bed" ? a.bed.label.localeCompare(b.bed.label) : (a.alarms.highest ? rank[a.alarms.highest] : 9) - (b.alarms.highest ? rank[b.alarms.highest] : 9) || a.bed.label.localeCompare(b.bed.label),
  );
  const compact = profile?.preferences.compact_tiles;

  return (
    <div>
      <PageHeader
        title="Live monitoring"
        subtitle={
          sim.data
            ? `Central station · simulation ${sim.data.running ? "running" : "paused"} · tick ${sim.data.tick} · clock ${fmtTime(sim.data.sim_time)}`
            : "Central station"
        }
        actions={
          <>
            <Select className="w-auto" value={ward} onChange={(e) => setWard(e.target.value)} aria-label="Ward">
              <option value="">All wards</option>
              {wards.data?.wards.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
            <Tabs value={sort} onChange={setSort} items={[{ value: "priority", label: "By priority" }, { value: "bed", label: "By bed" }]} />
          </>
        }
      />
      {q.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-72" />)}</div>
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !tiles.length ? (
        <EmptyState icon={<Activity className="size-6" />} title="No monitors are linked to beds" description="Link a monitor to a bed from the Devices page to start monitoring." />
      ) : (
        <div className={compact ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" : "grid gap-4 md:grid-cols-2 2xl:grid-cols-3"}>
          {tiles.map((t) => (
            <MonitorTile key={t.monitor.id} tile={t} showEcg={profile?.preferences.show_ecg !== false} compact={compact} />
          ))}
        </div>
      )}
      {!sim.data?.running && tiles.length > 0 && (
        <p className="mt-4 text-center text-sm text-navy-500">
          The simulation is paused — values update when a biomedical technician or administrator starts or advances it in the Simulation Lab.
        </p>
      )}
    </div>
  );
}
