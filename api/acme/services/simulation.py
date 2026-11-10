"""Simulation runner: loads state, advances the pure engine, persists results."""

from __future__ import annotations

import logging
import random
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from acme.core.config import get_settings
from acme.core.security import CurrentUser
from acme.db.client import first, get_client, insert_many, rows, table
from acme.services import integrations
from acme.services.ecg import ecg_strip
from acme.services.engine import (
    DEFAULT_BASELINE,
    PARAMS,
    SCENARIOS,
    MonitorSim,
    effective_limits,
    evaluate,
    reconcile,
    step,
)
from acme.services.events import log_event, log_events, make_event

log = logging.getLogger(__name__)

ALARM_COLUMNS = (
    "id,monitor_id,patient_id,bed_id,kind,type,priority,message,value,threshold,state,started_at,"
    "last_seen_at,cleared_at,acknowledged_at,acknowledged_by,acknowledged_by_name,ack_note,created_at"
)
_PRIORITY_RANK = {"low": 0, "medium": 1, "high": 2}


def _parse(ts: str | None) -> datetime | None:
    if not ts:
        return None
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def get_state() -> dict:
    st = first(table("sim_state").select("*").eq("id", 1).execute())
    if not st:
        st = first(table("sim_state").insert({"id": 1}).execute())
    return st  # type: ignore[return-value]


def load_limits() -> tuple[dict[str, dict], dict[str, dict[str, dict]]]:
    defaults: dict[str, dict] = {}
    per_patient: dict[str, dict[str, dict]] = {}
    for r in rows(table("alarm_thresholds").select("*").execute()):
        lim = {"low": r["low"], "high": r["high"], "enabled": r["enabled"]}
        if r["patient_id"]:
            per_patient.setdefault(r["patient_id"], {})[r["parameter"]] = lim
        else:
            defaults[r["parameter"]] = lim
    return defaults, per_patient


def advance(n: int, *, mode: str = "manual", actor: CurrentUser | None = None) -> dict:
    cfg = get_settings()
    n = max(1, min(n, cfg.max_ticks_per_request))
    now = datetime.now(timezone.utc)
    state = get_state()
    last = _parse(state.get("last_advanced_at"))
    if mode == "live":
        if not state["running"]:
            return {"skipped": True, "reason": "Simulation is paused", "state": state}
        if last and (now - last).total_seconds() < cfg.live_tick_min_interval_s:
            return {"skipped": True, "reason": "Tick already processed", "state": state}

    settings = first(table("system_settings").select("*").eq("id", 1).execute()) or {}
    battery_thr = float(settings.get("battery_low_threshold", 20))
    paging = bool(settings.get("paging_enabled", True))
    dt = int(state.get("tick_seconds") or 5)

    monitors = rows(table("monitors").select("*").not_.is_("bed_id", "null").eq("status", "in_use").execute())
    mon_ids = [m["id"] for m in monitors]
    beds = {b["id"]: b for b in rows(table("beds").select("id,label").execute())}
    patients_by_bed = {
        p["bed_id"]: p
        for p in rows(
            table("patients").select("id,bed_id,first_name,last_name,baseline").eq("status", "admitted").execute()
        )
        if p["bed_id"]
    }
    prev_states = (
        {s["monitor_id"]: s for s in rows(table("monitor_state").select("*").in_("monitor_id", mon_ids).execute())}
        if mon_ids
        else {}
    )
    active: dict[str, dict[str, dict]] = {}
    if mon_ids:
        for a in rows(table("alarms").select(ALARM_COLUMNS).eq("state", "active").in_("monitor_id", mon_ids).execute()):
            active.setdefault(a["monitor_id"], {})[a["type"]] = a
    defaults, per_patient = load_limits()

    sims: dict[str, MonitorSim] = {}
    for m in monitors:
        pat = patients_by_bed.get(m["bed_id"])
        prev = prev_states.get(m["id"]) or {}
        baseline = {**DEFAULT_BASELINE, **((pat or {}).get("baseline") or {})}
        vitals = {p: prev.get(p) for p in PARAMS if prev.get(p) is not None and prev.get("patient_id") == (pat or {}).get("id")}
        sims[m["id"]] = MonitorSim(
            monitor_id=m["id"],
            scenario=m["scenario"],
            battery=float(m["battery_level"]),
            connection=m["connection"],
            sensor_status=m["sensor_status"],
            patient_id=pat["id"] if pat else None,
            bed_id=m["bed_id"],
            baseline=baseline,
            vitals=vitals,
        )

    sim_time = _parse(state["sim_time"]) or now
    base = max(sim_time, now - timedelta(seconds=dt * n))
    tick = int(state["tick"])
    readings: list[dict] = []
    events: list[dict] = []
    dirty: dict[str, dict] = {}
    new_ids: set[str] = set()
    new_high: list[dict] = []
    last_reading: dict[str, tuple[dict | None, str, datetime]] = {}
    last_seen: dict[str, datetime] = {}
    raised = cleared = 0
    t = base

    for i in range(1, n + 1):
        tick += 1
        t = base + timedelta(seconds=dt * i)
        for mid, sim in sims.items():
            rng = random.Random(f"{mid}:{tick}")
            res = step(sim, rng, dt)
            for etype, sev, msg in res.transitions:
                events.append(make_event(etype, msg, source="simulation", severity=sev, monitor_id=mid,
                                         patient_id=sim.patient_id, tick=tick, occurred_at=t))
            if res.reading is not None:
                readings.append({"monitor_id": mid, "patient_id": sim.patient_id, "recorded_at": _iso(t),
                                 "signal_quality": res.signal_quality, "tick": tick, **res.reading})
            if sim.connection == "online":
                last_seen[mid] = t
            last_reading[mid] = (res.reading, res.signal_quality, t)

            limits = effective_limits(defaults, per_patient.get(sim.patient_id or "", {}))
            mon_active = active.setdefault(mid, {})
            conds, evaluated = evaluate(sim, res.reading, limits, battery_thr, set(mon_active))
            to_raise, to_refresh, to_clear = reconcile(mon_active, conds, evaluated)
            for c in to_raise:
                row = {
                    "id": str(uuid.uuid4()), "monitor_id": mid, "patient_id": sim.patient_id, "bed_id": sim.bed_id,
                    "kind": c.kind, "type": c.type, "priority": c.priority, "message": c.message, "value": c.value,
                    "threshold": c.threshold, "state": "active", "started_at": _iso(t), "last_seen_at": _iso(t),
                    "cleared_at": None, "acknowledged_at": None, "acknowledged_by": None,
                    "acknowledged_by_name": None, "ack_note": None, "created_at": _iso(now),
                }
                mon_active[c.type] = row
                dirty[row["id"]] = row
                new_ids.add(row["id"])
                raised += 1
                if c.priority == "high":
                    new_high.append(row)
                events.append(make_event("alarm_raised", c.message, source="simulation",
                                         severity="critical" if c.priority == "high" else "warning",
                                         monitor_id=mid, patient_id=sim.patient_id, tick=tick, occurred_at=t,
                                         payload={"alarm_id": row["id"], "type": c.type, "priority": c.priority}))
            for typ, c in to_refresh:
                row = mon_active[typ]
                row.update(last_seen_at=_iso(t), value=c.value, message=c.message)
                if _PRIORITY_RANK[c.priority] > _PRIORITY_RANK[row["priority"]]:
                    row["priority"] = c.priority  # escalate, never silently downgrade
                dirty[row["id"]] = row
            for typ in to_clear:
                row = mon_active.pop(typ)
                row.update(state="cleared", cleared_at=_iso(t))
                dirty[row["id"]] = row
                cleared += 1
                events.append(make_event("alarm_cleared", f"Condition resolved: {row['message']}", source="simulation",
                                         monitor_id=mid, patient_id=sim.patient_id, tick=tick, occurred_at=t,
                                         payload={"alarm_id": row["id"], "type": typ,
                                                  "was_acknowledged": bool(row["acknowledged_at"])}))

    # ---------------------------------------------------------------- persist
    if readings:
        insert_many("vital_readings", readings)

    state_rows, mon_rows = [], []
    for m in monitors:
        sim = sims[m["id"]]
        reading, quality, rt = last_reading[m["id"]]
        prev = prev_states.get(m["id"]) or {}
        rng = random.Random(f"ecg:{m['id']}:{tick}")
        if reading is not None:
            ecg = ecg_strip(reading["hr"], rng=rng, quality="good")
            values = {p: reading.get(p) for p in (*PARAMS, "map")}
            recorded_at = _iso(rt)
        else:
            ecg = ecg_strip(None, rng=rng, quality="lead_off")
            values = {p: prev.get(p) for p in (*PARAMS, "map")} if prev.get("patient_id") == sim.patient_id else {}
            recorded_at = prev.get("recorded_at") or _iso(rt)
        state_rows.append({
            "monitor_id": m["id"], "patient_id": sim.patient_id, "hr": values.get("hr"), "spo2": values.get("spo2"),
            "rr": values.get("rr"), "sbp": values.get("sbp"), "dbp": values.get("dbp"), "map": values.get("map"),
            "battery_level": round(sim.battery, 1), "signal_quality": quality, "ecg": ecg, "ecg_sample_rate": 125,
            "tick": tick, "recorded_at": recorded_at,
        })
        # telemetry only: never overwrite user-owned columns (scenario, bed, status)
        mon_rows.append({"id": m["id"], "battery_level": round(sim.battery, 1), "connection": sim.connection,
                         "sensor_status": sim.sensor_status,
                         "last_seen_at": _iso(last_seen[m["id"]]) if m["id"] in last_seen else None})

    if mon_rows:
        get_client().rpc("apply_monitor_telemetry", {"items": mon_rows}).execute()
    if state_rows:
        table("monitor_state").upsert(state_rows).execute()
    inserts = [r for i, r in dirty.items() if i in new_ids]
    updates = [{k: r[k] for k in ("id", "state", "cleared_at", "last_seen_at", "value", "message", "priority")}
               for i, r in dirty.items() if i not in new_ids]
    if updates:  # condition columns only, so a concurrent acknowledgement is preserved
        get_client().rpc("apply_alarm_updates", {"items": updates}).execute()
    if inserts:
        try:
            table("alarms").insert(inserts).execute()
        except Exception as exc:  # concurrent tick raced us on the one-active-alarm index
            log.warning("alarm insert conflict: %s", exc)
            new_high = []
    log_events(events)
    if paging and new_high:
        pages = []
        for a in new_high:
            pat = patients_by_bed.get(a["bed_id"])
            name = f"{pat['first_name']} {pat['last_name']}" if pat else None
            pages.append(integrations.page_for_alarm(a, beds.get(a["bed_id"], {}).get("label"), name))
        integrations.send(pages)

    new_state = first(
        table("sim_state")
        .update({"tick": tick, "sim_time": _iso(t), "last_advanced_at": _iso(now), "updated_at": _iso(now)})
        .eq("id", 1)
        .execute()
    )
    if mode == "manual" and actor:
        log_event("simulation_advanced", f"Simulation advanced by {n} tick(s) ({n * dt}s of monitoring)",
                  source="user", actor=actor, tick=tick, payload={"ticks": n})
    return {
        "skipped": False, "ticks": n, "state": new_state, "readings": len(readings),
        "alarms_raised": raised, "alarms_cleared": cleared, "monitors": len(monitors),
    }


def set_scenario(monitor_id: str, scenario: str, actor: CurrentUser) -> dict:
    if scenario not in SCENARIOS:
        raise HTTPException(422, "Unknown scenario")
    mon = first(table("monitors").select("*").eq("id", monitor_id).execute())
    if not mon:
        raise HTTPException(404, "Monitor not found")
    upd = first(table("monitors").update({"scenario": scenario}).eq("id", monitor_id).execute())
    log_event("scenario_changed", f"Scenario for {mon['asset_tag']} set to “{SCENARIOS[scenario]}”",
              source="user", actor=actor, monitor_id=monitor_id, payload={"from": mon["scenario"], "to": scenario})
    return upd  # type: ignore[return-value]


def set_running(running: bool, actor: CurrentUser) -> dict:
    st = first(table("sim_state").update({"running": running, "updated_at": _iso(datetime.now(timezone.utc))})
               .eq("id", 1).execute())
    log_event("simulation_started" if running else "simulation_paused",
              "Live simulation started" if running else "Live simulation paused", source="user", actor=actor)
    return st  # type: ignore[return-value]
