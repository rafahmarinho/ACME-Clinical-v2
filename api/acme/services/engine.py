"""Pure simulation + alarm logic (no I/O). Persistence lives in `simulation.py`."""

from __future__ import annotations

import random
from dataclasses import dataclass, field

PARAMS = ("hr", "spo2", "rr", "sbp", "dbp")

PARAM_LABEL = {
    "hr": ("Heart rate", "bpm"),
    "spo2": ("SpO₂", "%"),
    "rr": ("Respiratory rate", "rpm"),
    "sbp": ("Systolic BP", "mmHg"),
    "dbp": ("Diastolic BP", "mmHg"),
}

SCENARIOS = {
    "normal": "Normal readings",
    "low_spo2": "Low oxygen saturation",
    "low_battery": "Low battery",
    "sensor_fault": "SpO₂ sensor problem",
    "connection_loss": "Connection loss",
}

DEFAULT_BASELINE = {"hr": 78.0, "spo2": 97.0, "rr": 16.0, "sbp": 122.0, "dbp": 78.0}

# physiological bounds the random walk never leaves
_BOUNDS = {"hr": (30, 190), "spo2": (70, 100), "rr": (5, 45), "sbp": (60, 220), "dbp": (30, 130)}
_NOISE = {"hr": 1.6, "spo2": 0.45, "rr": 0.7, "sbp": 2.2, "dbp": 1.5}
# An active alarm only clears once the value is back inside the limit by this margin (prevents flapping).
HYSTERESIS = {"hr": 3, "spo2": 1, "rr": 2, "sbp": 4, "dbp": 3}


@dataclass
class MonitorSim:
    """Mutable per-monitor state carried across ticks."""

    monitor_id: str
    scenario: str
    battery: float
    connection: str = "online"
    sensor_status: str = "ok"
    patient_id: str | None = None
    bed_id: str | None = None
    baseline: dict = field(default_factory=lambda: dict(DEFAULT_BASELINE))
    vitals: dict = field(default_factory=dict)  # last values (may be empty)


@dataclass
class TickResult:
    reading: dict | None  # None when no data reached the central station
    signal_quality: str
    transitions: list[tuple[str, str, str]]  # (event_type, severity, message)


def _clamp(p: str, v: float) -> float:
    lo, hi = _BOUNDS[p]
    return max(lo, min(hi, v))


def targets_for(sim: MonitorSim) -> dict:
    t = dict(sim.baseline)
    if sim.scenario == "low_spo2":
        t["spo2"] = 84.0
        t["hr"] = sim.baseline["hr"] + 18
        t["rr"] = sim.baseline["rr"] + 9
    return t


def step(sim: MonitorSim, rng: random.Random, dt_seconds: float, battery_low_threshold: float = 20) -> TickResult:
    """Advance one monitor by one tick and return the reading it would send."""
    transitions: list[tuple[str, str, str]] = []
    k = min(1.0, 0.18 * dt_seconds / 5.0)  # approach rate toward target

    # --- device: battery ------------------------------------------------------
    if sim.scenario == "low_battery":
        sim.battery = max(2.0, sim.battery - 2.5 * dt_seconds / 5.0)
    else:  # docked on mains: recharge
        sim.battery = min(100.0, sim.battery + 1.0 * dt_seconds / 5.0)

    # --- device: connectivity --------------------------------------------------
    new_conn = "offline" if sim.scenario == "connection_loss" else "online"
    if new_conn != sim.connection:
        if new_conn == "offline":
            transitions.append(("connection_lost", "warning", "Monitor stopped reporting to the central station"))
        else:
            transitions.append(("connection_restored", "info", "Monitor reconnected to the central station"))
        sim.connection = new_conn

    # --- device: SpO2 probe ----------------------------------------------------
    new_sensor = "fault" if sim.scenario == "sensor_fault" else "ok"
    if new_sensor != sim.sensor_status:
        if new_sensor == "fault":
            transitions.append(("sensor_fault", "warning", "SpO₂ probe reports an invalid signal"))
        else:
            transitions.append(("sensor_restored", "info", "SpO₂ probe signal restored"))
        sim.sensor_status = new_sensor

    # --- physiology (keeps evolving even when we cannot see it) -------------------
    tgt = targets_for(sim)
    for p in PARAMS:
        cur = sim.vitals.get(p)
        if cur is None:
            cur = tgt[p]
        nxt = cur + (tgt[p] - cur) * k + rng.gauss(0, _NOISE[p])
        if p == "spo2":
            nxt = min(100.0, nxt)
        sim.vitals[p] = round(_clamp(p, nxt), 1)
    if sim.vitals["dbp"] >= sim.vitals["sbp"] - 15:
        sim.vitals["dbp"] = round(sim.vitals["sbp"] - 15, 1)

    if sim.connection == "offline" or not sim.patient_id:
        return TickResult(None, "no_signal", transitions)

    reading = {p: sim.vitals[p] for p in PARAMS}
    quality = "good"
    if sim.sensor_status == "fault":
        reading["spo2"] = None
        quality = "sensor_fault"
    reading["map"] = round((reading["sbp"] + 2 * reading["dbp"]) / 3, 1)
    reading["battery_level"] = round(sim.battery, 1)
    return TickResult(reading, quality, transitions)


# ---------------------------------------------------------------------------
# Alarm evaluation
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Condition:
    type: str
    kind: str  # physiological | technical
    priority: str  # high | medium | low
    message: str
    value: float | None = None
    threshold: float | None = None


def effective_limits(defaults: dict[str, dict], overrides: dict[str, dict]) -> dict[str, dict]:
    """Merge unit defaults with patient-specific overrides (per parameter)."""
    out = {p: dict(v) for p, v in defaults.items()}
    for p, v in overrides.items():
        out[p] = dict(v)
    return out


def evaluate(
    sim: MonitorSim,
    reading: dict | None,
    limits: dict[str, dict],
    battery_low_threshold: float = 20,
    active_types: set[str] | frozenset[str] = frozenset(),
) -> tuple[list[Condition], set[str]]:
    """Return (active conditions, alarm types that were evaluated this tick).

    Types not evaluated (e.g. SpO2 while the probe is faulty, everything while offline)
    must keep their current state: missing data is not proof that a condition ended.
    """
    conds: list[Condition] = []
    evaluated: set[str] = {"connection_lost", "battery_low", "sensor_fault"}

    if sim.connection == "offline":
        conds.append(Condition("connection_lost", "technical", "medium", "No data from monitor — connection lost"))
        return conds, evaluated  # physiological + battery unknown while offline
    batt_thr = battery_low_threshold + (5 if "battery_low" in active_types else 0)
    if sim.battery < batt_thr:
        conds.append(
            Condition("battery_low", "technical", "low", f"Monitor battery low ({sim.battery:.0f}%)", sim.battery, battery_low_threshold)
        )
    if sim.sensor_status == "fault":
        conds.append(Condition("sensor_fault", "technical", "medium", "SpO₂ sensor problem — check probe"))
    if reading is None:
        return conds, evaluated

    for p in PARAMS:
        lim = limits.get(p)
        val = reading.get(p)
        if not lim or not lim.get("enabled", True):
            evaluated.update({f"{p}_low", f"{p}_high"})
            continue
        if val is None:
            continue
        evaluated.update({f"{p}_low", f"{p}_high"})
        label, unit = PARAM_LABEL[p]
        low, high = lim.get("low"), lim.get("high")
        m = HYSTERESIS[p]
        low_eff = None if low is None else (low + m if f"{p}_low" in active_types else low)
        high_eff = None if high is None else (high - m if f"{p}_high" in active_types else high)
        if low_eff is not None and val < low_eff:
            severe = (p == "spo2" and val < low - 4) or (p != "spo2" and val < low * 0.85)
            conds.append(
                Condition(f"{p}_low", "physiological", "high" if severe else "medium",
                          f"{label} low: {val:.0f} {unit} (limit {low:.0f})", val, low)
            )
        elif high_eff is not None and val > high_eff:
            severe = val > high * 1.15
            conds.append(
                Condition(f"{p}_high", "physiological", "high" if severe else "medium",
                          f"{label} high: {val:.0f} {unit} (limit {high:.0f})", val, high)
            )
    return conds, evaluated


def reconcile(
    active: dict[str, dict], conditions: list[Condition], evaluated: set[str]
) -> tuple[list[Condition], list[tuple[str, Condition]], list[str]]:
    """Diff current conditions against active alarms for one monitor.

    active: {alarm_type: alarm_row}
    Returns (to_raise, to_refresh[(type, cond)], to_clear[type]).
    Acknowledged alarms are still 'active' and are only cleared here, when the condition ends.
    """
    present = {c.type: c for c in conditions}
    to_raise = [c for t, c in present.items() if t not in active]
    to_refresh = [(t, c) for t, c in present.items() if t in active]
    to_clear = [t for t in active if t not in present and t in evaluated]
    return to_raise, to_refresh, to_clear
