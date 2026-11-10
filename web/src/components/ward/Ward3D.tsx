import { Html, OrbitControls, RoundedBox } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Ward, WardBed } from "../../types";

const COLORS = {
  floor: "#f4f7fc",
  frame: "#cdd7ea",
  mattress: "#ffffff",
  navy: "#0b1f44",
  ok: "#10b981",
  high: "#dc2626",
  medium: "#f59e0b",
  low: "#06b6d4",
  off: "#94a3b8",
  patient: "#7dd3fc",
};

function bedColor(b: WardBed) {
  if (!b.monitor) return COLORS.off;
  if (b.monitor.connection === "offline") return COLORS.off;
  if (b.alarms.highest === "high") return COLORS.high;
  if (b.alarms.highest === "medium") return COLORS.medium;
  if (b.alarms.highest === "low") return COLORS.low;
  return COLORS.ok;
}

function Beacon({ color, active, fast }: { color: string; active: boolean; fast: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime() * (fast ? 7 : 3);
    const k = active ? 0.55 + 0.45 * Math.sin(t) : 0.15;
    (ref.current.material as THREE.MeshStandardMaterial).emissiveIntensity = active ? 1.6 * k : 0.2;
    if (light.current) light.current.intensity = active ? 6 * k : 0;
  });
  return (
    <group position={[0, 2.25, -1.25]}>
      <mesh ref={ref}>
        <sphereGeometry args={[0.13, 20, 20]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} />
      </mesh>
      <pointLight ref={light} color={color} distance={4} intensity={0} />
    </group>
  );
}

function MonitorScreen({ color, online }: { color: string; online: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current || !online) return;
    const beat = (clock.getElapsedTime() * 1.3) % 1;
    (ref.current.material as THREE.MeshStandardMaterial).emissiveIntensity = beat < 0.12 ? 1.4 : 0.55;
  });
  return (
    <group position={[0.95, 1.25, -1.15]}>
      <mesh position={[0, -0.6, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 1.2]} />
        <meshStandardMaterial color="#64748b" />
      </mesh>
      <RoundedBox args={[0.6, 0.42, 0.08]} radius={0.03}>
        <meshStandardMaterial color={COLORS.navy} />
      </RoundedBox>
      <mesh ref={ref} position={[0, 0, 0.045]}>
        <planeGeometry args={[0.5, 0.32]} />
        <meshStandardMaterial color={online ? color : "#1e293b"} emissive={online ? color : "#000"} emissiveIntensity={0.55} />
      </mesh>
    </group>
  );
}

function Bed({ bed, onSelect, selected }: { bed: WardBed; onSelect: (b: WardBed) => void; selected: boolean }) {
  const color = bedColor(bed);
  const alarming = bed.alarms.count > 0;
  const unack = bed.alarms.unacknowledged > 0;
  const facing = bed.pos_z > 0 ? Math.PI : 0;
  return (
    <group position={[bed.pos_x, 0, bed.pos_z]} rotation={[0, facing, 0]}>
      <group
        onClick={(e) => {
          e.stopPropagation();
          onSelect(bed);
        }}
        onPointerOver={() => (document.body.style.cursor = "pointer")}
        onPointerOut={() => (document.body.style.cursor = "auto")}
      >
        {/* floor zone */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
          <planeGeometry args={[2.8, 3.2]} />
          <meshStandardMaterial color={selected ? "#dbe5f6" : alarming ? (bed.alarms.highest === "high" ? "#fee2e2" : "#fef3c7") : "#ffffff"} />
        </mesh>
        {/* frame */}
        <RoundedBox args={[1.1, 0.45, 2.1]} radius={0.06} position={[0, 0.35, 0]}>
          <meshStandardMaterial color={COLORS.frame} />
        </RoundedBox>
        <RoundedBox args={[1.0, 0.14, 1.95]} radius={0.05} position={[0, 0.64, 0]}>
          <meshStandardMaterial color={COLORS.mattress} />
        </RoundedBox>
        <RoundedBox args={[1.1, 0.7, 0.08]} radius={0.03} position={[0, 0.75, -1.05]}>
          <meshStandardMaterial color={COLORS.navy} />
        </RoundedBox>
        <RoundedBox args={[0.6, 0.12, 0.35]} radius={0.05} position={[0, 0.76, -0.72]}>
          <meshStandardMaterial color="#f1f5f9" />
        </RoundedBox>
        {bed.patient && (
          <group>
            <mesh position={[0, 0.86, -0.7]}>
              <sphereGeometry args={[0.15, 20, 20]} />
              <meshStandardMaterial color="#f2c9a5" />
            </mesh>
            <RoundedBox args={[0.82, 0.16, 1.3]} radius={0.07} position={[0, 0.78, 0.2]}>
              <meshStandardMaterial color={COLORS.patient} />
            </RoundedBox>
          </group>
        )}
        {bed.monitor && <MonitorScreen color={color} online={bed.monitor.connection === "online"} />}
        <Beacon color={color} active={alarming} fast={unack && bed.alarms.highest === "high"} />
      </group>
      <Html position={[0, 2.7, -1.2]} center distanceFactor={11} zIndexRange={[10, 0]}>
        <div
          onClick={() => onSelect(bed)}
          className="pointer-events-auto cursor-pointer select-none whitespace-nowrap rounded-md bg-white/95 px-2 py-1 text-center shadow ring-1 ring-navy-200"
        >
          <div className="text-[13px] font-extrabold text-navy-900">{bed.label}</div>
          <div className="text-[11px] font-medium text-navy-500">{bed.patient ? bed.patient.last_name : "Empty"}</div>
          {bed.vitals && (
            <div className="tabular mt-0.5 flex gap-1.5 text-[11px] font-bold">
              <span className="text-hr">♥ {Math.round(bed.vitals.hr ?? 0)}</span>
              <span className="text-spo2">{bed.vitals.spo2 != null ? `${Math.round(bed.vitals.spo2)}%` : "--"}</span>
            </div>
          )}
        </div>
      </Html>
    </group>
  );
}

/** Nurse avatar that walks to the most urgent bed (or rests at the station). */
function Nurse({ target }: { target: THREE.Vector3 }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }, dt) => {
    const g = ref.current;
    if (!g) return;
    const d = target.clone().sub(g.position);
    d.y = 0;
    const dist = d.length();
    if (dist > 0.05) {
      g.position.add(d.normalize().multiplyScalar(Math.min(dist, dt * 2.6)));
      g.rotation.y = Math.atan2(d.x, d.z);
      g.position.y = Math.abs(Math.sin(clock.getElapsedTime() * 10)) * 0.05;
    } else g.position.y = 0;
  });
  return (
    <group ref={ref} position={[0, 0, 0]}>
      <mesh position={[0, 0.65, 0]}>
        <capsuleGeometry args={[0.22, 0.75, 8, 16]} />
        <meshStandardMaterial color="#1d4ed8" />
      </mesh>
      <mesh position={[0, 1.42, 0]}>
        <sphereGeometry args={[0.17, 20, 20]} />
        <meshStandardMaterial color="#e0b08a" />
      </mesh>
    </group>
  );
}

function Station() {
  return (
    <group position={[0, 0, 0]}>
      <RoundedBox args={[3.4, 0.9, 0.9]} radius={0.08} position={[0, 0.45, 0]}>
        <meshStandardMaterial color="#e8eef8" />
      </RoundedBox>
      <RoundedBox args={[0.9, 0.5, 0.05]} radius={0.02} position={[-0.8, 1.15, 0]}>
        <meshStandardMaterial color={COLORS.navy} emissive="#0ea5e9" emissiveIntensity={0.15} />
      </RoundedBox>
      <RoundedBox args={[0.9, 0.5, 0.05]} radius={0.02} position={[0.8, 1.15, 0]}>
        <meshStandardMaterial color={COLORS.navy} emissive="#0ea5e9" emissiveIntensity={0.15} />
      </RoundedBox>
      <Html position={[0, 1.7, 0]} center distanceFactor={12}>
        <div className="whitespace-nowrap rounded bg-navy-900 px-2 py-0.5 text-[11px] font-bold text-white">Nurses’ station</div>
      </Html>
    </group>
  );
}

export function Ward3D({ ward, onSelect, selectedId }: { ward: Ward; onSelect: (b: WardBed) => void; selectedId?: string | null }) {
  const rank = { high: 3, medium: 2, low: 1 } as const;
  const target = useMemo(() => {
    const urgent = [...ward.beds]
      .filter((b) => b.alarms.count > 0)
      .sort((a, b) => (rank[b.alarms.highest!] ?? 0) - (rank[a.alarms.highest!] ?? 0) || b.alarms.unacknowledged - a.alarms.unacknowledged)[0];
    if (!urgent) return new THREE.Vector3(0, 0, 1.0);
    const side = urgent.pos_z > 0 ? -1 : 1;
    return new THREE.Vector3(urgent.pos_x - 0.95, 0, urgent.pos_z + side * 0.4);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ward]);
  const width = Math.max(...ward.beds.map((b) => Math.abs(b.pos_x))) * 2 + 5;

  return (
    <Canvas shadows={false} camera={{ position: [0, 11, 11], fov: 42 }} dpr={[1, 2]} style={{ background: "#ffffff" }}>
      <ambientLight intensity={0.9} />
      <directionalLight position={[6, 12, 6]} intensity={1.1} />
      <hemisphereLight args={["#ffffff", "#cdd7ea", 0.5]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} onClick={() => undefined}>
        <planeGeometry args={[width, 12]} />
        <meshStandardMaterial color={COLORS.floor} />
      </mesh>
      <gridHelper args={[Math.max(width, 12), 24, "#e2e8f3", "#eef2f9"]} position={[0, 0.002, 0]} />
      <Station />
      {ward.beds.map((b) => (
        <Bed key={b.id} bed={b} onSelect={onSelect} selected={selectedId === b.id} />
      ))}
      <Nurse target={target} />
      <OrbitControls enablePan={false} minDistance={7} maxDistance={24} maxPolarAngle={Math.PI / 2.3} target={[0, 0, 0]} />
    </Canvas>
  );
}
