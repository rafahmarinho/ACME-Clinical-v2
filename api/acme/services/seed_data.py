"""Demo data: 2 wards, 14 beds, 12 fictitious patients, 10 simulated monitors.

`reset_demo_data()` wipes clinical/simulation data (staff accounts are kept) and rebuilds it,
including two hours of reading history with a few past alarm episodes.
"""

from __future__ import annotations

import random
import uuid
from datetime import date, datetime, timedelta, timezone

from acme.core.security import CurrentUser
from acme.db.client import insert_many, rows, table
from acme.services.ecg import ecg_strip
from acme.services.engine import DEFAULT_BASELINE, PARAMS, MonitorSim, effective_limits, evaluate, reconcile, step
from acme.services.events import log_event, make_event

ZERO = "00000000-0000-0000-0000-000000000000"

WARDS = [
    {"code": "ICU", "name": "Intensive Care Unit", "floor": "4th floor — North wing",
     "description": "Adult medical-surgical ICU", "beds": 8, "sort_order": 1},
    {"code": "SDU", "name": "Cardiac Step-Down Unit", "floor": "3rd floor — East wing",
     "description": "Telemetry and post-procedure monitoring", "beds": 6, "sort_order": 2},
]

# (first, last, sex, age, bed, diagnosis, acuity, attending, allergies, code status, baseline overrides)
PATIENTS = [
    ("Margaret", "Holloway", "female", 72, "ICU-01", "Community-acquired pneumonia, sepsis", "critical", "Dr. Evan Brooks", ["Penicillin"], "Full code", {"hr": 96, "spo2": 94, "rr": 22, "sbp": 108, "dbp": 64}),
    ("Daniel", "Okafor", "male", 58, "ICU-02", "Post-op CABG x3, day 1", "high", "Dr. Evan Brooks", [], "Full code", {"hr": 84, "sbp": 118, "dbp": 72}),
    ("Rosa", "Delgado", "female", 66, "ICU-03", "COPD exacerbation", "high", "Dr. Priya Raman", ["Sulfa drugs"], "DNR", {"spo2": 92, "rr": 20, "hr": 88}),
    ("Thomas", "Whitaker", "male", 81, "ICU-04", "Acute decompensated heart failure", "high", "Dr. Priya Raman", [], "DNR/DNI", {"hr": 92, "sbp": 104, "dbp": 62, "spo2": 95}),
    ("Aisha", "Rahman", "female", 45, "ICU-05", "Diabetic ketoacidosis", "high", "Dr. Evan Brooks", ["Latex"], "Full code", {"hr": 104, "rr": 24}),
    ("Victor", "Lindqvist", "male", 63, "ICU-06", "Subarachnoid hemorrhage, post-coiling", "critical", "Dr. Priya Raman", [], "Full code", {"sbp": 134, "dbp": 80, "hr": 70}),
    ("Grace", "Nakamura", "female", 54, "ICU-07", "Acute pancreatitis", "moderate", "Dr. Evan Brooks", ["Morphine"], "Full code", {"hr": 90}),
    ("Samuel", "Achebe", "male", 69, "SDU-01", "NSTEMI, post-PCI", "moderate", "Dr. Priya Raman", ["Aspirin (mild)"], "Full code", {"hr": 72, "sbp": 128}),
    ("Elena", "Petrova", "female", 77, "SDU-02", "Atrial fibrillation with RVR, rate controlled", "moderate", "Dr. Evan Brooks", [], "Full code", {"hr": 86}),
    ("Marcus", "Bell", "male", 49, "SDU-03", "Syncope, under evaluation", "low", "Dr. Priya Raman", [], "Full code", {"hr": 66, "sbp": 116}),
    ("Hannah", "Fischer", "female", 38, "SDU-04", "Pulmonary embolism on anticoagulation", "moderate", "Dr. Evan Brooks", ["Iodinated contrast"], "Full code", {"hr": 94, "spo2": 95, "rr": 19}),
    ("Oliver", "Grant", "male", 84, "SDU-05", "Post-TAVR monitoring", "low", "Dr. Priya Raman", [], "DNR", {"hr": 68, "sbp": 132, "dbp": 70}),
]

# (asset tag, serial, model, firmware, bed or None, status)
MONITORS = [
    ("PM-1001", "VX5-23A0141", "VitaTrack X5", "4.2.1", "ICU-01", "in_use"),
    ("PM-1002", "VX5-23A0157", "VitaTrack X5", "4.2.1", "ICU-02", "in_use"),
    ("PM-1003", "VX5-23A0162", "VitaTrack X5", "4.2.1", "ICU-03", "in_use"),
    ("PM-1004", "VX5-22B0988", "VitaTrack X5", "4.1.7", "ICU-04", "in_use"),
    ("PM-1005", "VX5-22B1012", "VitaTrack X5", "4.1.7", "ICU-05", "in_use"),
    ("PM-1006", "VX7-24C0033", "VitaTrack X7", "5.0.2", "ICU-06", "in_use"),
    ("PM-1007", "VX7-24C0041", "VitaTrack X7", "5.0.2", "ICU-07", "in_use"),
    ("PM-1008", "VM3-21D2210", "VitaMini M3", "3.8.0", "SDU-01", "in_use"),
    ("PM-1009", "VM3-21D2234", "VitaMini M3", "3.8.0", None, "available"),
    ("PM-1010", "VM3-21D2251", "VitaMini M3", "3.7.4", None, "maintenance"),
]

DEFAULT_LIMITS = {
    "hr": (50, 120), "spo2": (90, None), "rr": (8, 28), "sbp": (90, 160), "dbp": (50, 100),
}

HISTORY_MINUTES = 120


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def _wipe() -> None:
    table("integration_messages").delete().gte("id", 0).execute()
    table("events").delete().gte("id", 0).execute()
    table("alarms").delete().neq("id", ZERO).execute()
    table("vital_readings").delete().gte("id", 0).execute()
    table("monitor_state").delete().neq("monitor_id", ZERO).execute()
    table("observations").delete().neq("id", ZERO).execute()
    table("maintenance_records").delete().neq("id", ZERO).execute()
    table("reports").delete().neq("id", ZERO).execute()
    table("alarm_thresholds").delete().neq("id", ZERO).execute()
    table("monitors").delete().neq("id", ZERO).execute()
    table("patients").delete().neq("id", ZERO).execute()
    table("beds").delete().neq("id", ZERO).execute()
    table("wards").delete().neq("id", ZERO).execute()


def _staff() -> dict[str, list[dict]]:
    by_role: dict[str, list[dict]] = {}
    for p in rows(table("profiles").select("id,full_name,role").eq("is_active", True).execute()):
        by_role.setdefault(p["role"], []).append(p)
    return by_role


def reset_demo_data(actor: CurrentUser | None = None) -> dict:
    rng = random.Random(2026)
    now = datetime.now(timezone.utc).replace(microsecond=0)
    _wipe()
    staff = _staff()

    # --- wards & beds -------------------------------------------------------------
    bed_by_label: dict[str, dict] = {}
    for w in WARDS:
        ward = rows(table("wards").insert({k: w[k] for k in ("code", "name", "floor", "description", "sort_order")}).execute())[0]
        beds = []
        per_row = (w["beds"] + 1) // 2
        for i in range(w["beds"]):
            row_idx, col = divmod(i, per_row)
            beds.append({
                "ward_id": ward["id"], "label": f"{w['code']}-{i + 1:02d}",
                "pos_x": round((col - (per_row - 1) / 2) * 3.2, 2), "pos_z": -3.2 if row_idx == 0 else 3.2,
            })
        for b in insert_many("beds", beds):
            bed_by_label[b["label"]] = b

    # --- patients -------------------------------------------------------------------
    patient_rows = []
    for idx, (fn, ln, sex, age, bed, dx, acuity, doc, allergies, code, base) in enumerate(PATIENTS):
        dob = date(now.year - age, rng.randint(1, 12), rng.randint(1, 28))
        patient_rows.append({
            "mrn": f"MRN-{480211 + idx * 37}", "first_name": fn, "last_name": ln, "date_of_birth": dob.isoformat(),
            "sex": sex, "bed_id": bed_by_label[bed]["id"], "diagnosis": dx, "acuity": acuity,
            "attending_physician": doc, "allergies": allergies, "code_status": code,
            "admitted_at": _iso(now - timedelta(hours=rng.randint(10, 140))),
            "baseline": {**DEFAULT_BASELINE, **{k: float(v) for k, v in base.items()}},
        })
    patients = insert_many("patients", patient_rows)
    patient_by_bed = {p["bed_id"]: p for p in patients}

    # --- limits ---------------------------------------------------------------------
    thresholds = [{"patient_id": None, "parameter": p, "low": lo, "high": hi, "enabled": True}
                  for p, (lo, hi) in DEFAULT_LIMITS.items()]
    copd = next(p for p in patients if p["last_name"] == "Delgado")
    thresholds.append({"patient_id": copd["id"], "parameter": "spo2", "low": 88, "high": None, "enabled": True})
    dka = next(p for p in patients if p["last_name"] == "Rahman")
    thresholds.append({"patient_id": dka["id"], "parameter": "hr", "low": 50, "high": 130, "enabled": True})
    insert_many("alarm_thresholds", thresholds)
    defaults = {t["parameter"]: {"low": t["low"], "high": t["high"], "enabled": True} for t in thresholds if not t["patient_id"]}
    overrides: dict[str, dict] = {}
    for t in thresholds:
        if t["patient_id"]:
            overrides.setdefault(t["patient_id"], {})[t["parameter"]] = {"low": t["low"], "high": t["high"], "enabled": True}

    # --- monitors -------------------------------------------------------------------
    mon_rows = []
    for tag, serial, model, fw, bed, status in MONITORS:
        last_pm = now - timedelta(days=rng.randint(20, 160))
        mon_rows.append({
            "asset_tag": tag, "serial_number": serial, "model": model, "manufacturer": "Meridian Medical Systems",
            "firmware": fw, "bed_id": bed_by_label[bed]["id"] if bed else None, "status": status,
            "connection": "online" if status != "maintenance" else "offline", "sensor_status": "ok",
            "battery_level": 100 if status != "maintenance" else 41, "scenario": "normal",
            "last_seen_at": _iso(now), "last_maintenance_at": _iso(last_pm),
            "next_maintenance_due": (last_pm + timedelta(days=180)).date().isoformat(),
        })
    monitors = insert_many("monitors", mon_rows)

    # --- two hours of history, with scripted episodes ---------------------------------
    # minute offsets (from the start of history) where a monitor switches scenario
    script = {
        "PM-1003": [(40, "low_spo2"), (58, "normal")],         # desaturation episode
        "PM-1005": [(85, "connection_loss"), (92, "normal")],  # network drop
        "PM-1006": [(20, "sensor_fault"), (27, "normal")],     # probe fell off
        "PM-1002": [(60, "low_battery"), (95, "normal")],      # unplugged during transport
    }
    readings, alarms, events = [], [], []
    states = []
    t0 = now - timedelta(minutes=HISTORY_MINUTES)
    for m in monitors:
        if not m["bed_id"]:
            continue
        pat = patient_by_bed.get(m["bed_id"])
        sim = MonitorSim(monitor_id=m["id"], scenario="normal", battery=100.0, patient_id=pat["id"] if pat else None,
                         bed_id=m["bed_id"], baseline=dict(pat["baseline"]) if pat else dict(DEFAULT_BASELINE))
        limits = effective_limits(defaults, overrides.get(sim.patient_id or "", {}))
        changes = dict(script.get(m["asset_tag"], []))
        active: dict[str, dict] = {}
        last = None
        for minute in range(HISTORY_MINUTES + 1):
            t = t0 + timedelta(minutes=minute)
            if minute in changes:
                sim.scenario = changes[minute]
            res = step(sim, random.Random(f"hist:{m['id']}:{minute}"), 60)
            for et, sev, msg in res.transitions:
                events.append(make_event(et, msg, source="simulation", severity=sev, monitor_id=m["id"],
                                         patient_id=sim.patient_id, occurred_at=t))
            if res.reading:
                readings.append({"monitor_id": m["id"], "patient_id": sim.patient_id, "recorded_at": _iso(t),
                                 "signal_quality": res.signal_quality, "tick": 0, **res.reading})
                last = (res.reading, t)
            conds, evaluated = evaluate(sim, res.reading, limits, active_types=set(active))
            to_raise, to_refresh, to_clear = reconcile(active, conds, evaluated)
            for c in to_raise:
                a = {"id": str(uuid.uuid4()), "monitor_id": m["id"], "patient_id": sim.patient_id, "bed_id": m["bed_id"],
                     "kind": c.kind, "type": c.type, "priority": c.priority, "message": c.message, "value": c.value,
                     "threshold": c.threshold, "state": "active", "started_at": _iso(t), "last_seen_at": _iso(t),
                     "cleared_at": None, "acknowledged_at": None, "acknowledged_by": None,
                     "acknowledged_by_name": None, "ack_note": None}
                active[c.type] = a
                alarms.append(a)
                events.append(make_event("alarm_raised", c.message, source="simulation",
                                         severity="critical" if c.priority == "high" else "warning",
                                         monitor_id=m["id"], patient_id=sim.patient_id, occurred_at=t,
                                         payload={"alarm_id": a["id"], "type": c.type}))
            for typ, c in to_refresh:
                active[typ].update(last_seen_at=_iso(t), value=c.value)
            for typ in to_clear:
                a = active.pop(typ)
                a.update(state="cleared", cleared_at=_iso(t))
                events.append(make_event("alarm_cleared", f"Condition resolved: {a['message']}", source="simulation",
                                         monitor_id=m["id"], patient_id=sim.patient_id, occurred_at=t,
                                         payload={"alarm_id": a["id"], "type": typ}))
        # acknowledge most historical alarms with a realistic delay
        for a in alarms:
            if a["monitor_id"] == m["id"] and rng.random() < 0.8:
                responder = rng.choice(staff.get("nurse") or staff.get("admin") or [None])
                start = datetime.fromisoformat(a["started_at"])
                a.update(acknowledged_at=_iso(start + timedelta(seconds=rng.randint(25, 170))),
                         acknowledged_by=responder["id"] if responder else None,
                         acknowledged_by_name=responder["full_name"] if responder else "Charge Nurse",
                         ack_note=rng.choice(["Patient assessed at bedside", "Probe repositioned", "Physician notified", None]))
        m.update(battery_level=round(sim.battery, 1))
        if last:
            r, t = last
            states.append({"monitor_id": m["id"], "patient_id": sim.patient_id, **{p: r.get(p) for p in (*PARAMS, "map")},
                           "battery_level": round(sim.battery, 1), "signal_quality": "good",
                           "ecg": ecg_strip(r["hr"], rng=random.Random(m["id"])), "ecg_sample_rate": 125,
                           "tick": 0, "recorded_at": _iso(t)})
    insert_many("vital_readings", readings)
    insert_many("alarms", alarms)
    insert_many("monitor_state", states)
    for m in monitors:
        table("monitors").update({"battery_level": m["battery_level"]}).eq("id", m["id"]).execute()

    # --- observations ------------------------------------------------------------------
    nurses = staff.get("nurse", []) or staff.get("admin", [])
    doctors = staff.get("physician", []) or staff.get("admin", [])
    notes = [
        ("assessment", "Alert and oriented x3. Lungs with coarse crackles at bases. Skin warm and dry."),
        ("intervention", "Repositioned to semi-Fowler's. Incentive spirometry encouraged x10."),
        ("medication", "Scheduled medications administered per MAR. No adverse reactions observed."),
        ("note", "Family updated at bedside on plan of care."),
    ]
    obs = []
    for i, p in enumerate(patients):
        for j in range(2):
            author = (nurses or [None])[j % max(1, len(nurses))] if j == 0 else (doctors or [None])[0]
            cat, text = notes[(i + j) % len(notes)]
            obs.append({"patient_id": p["id"], "author_id": author["id"] if author else None,
                        "author_name": author["full_name"] if author else "Charge Nurse",
                        "author_role": author["role"] if author else "nurse", "category": cat, "note": text,
                        "created_at": _iso(now - timedelta(minutes=30 + 47 * j + i * 3))})
    insert_many("observations", obs)

    # --- maintenance -------------------------------------------------------------------------
    tech = (staff.get("biomed") or staff.get("admin") or [None])[0]
    tech_fields = {"technician_id": tech["id"] if tech else None, "technician_name": tech["full_name"] if tech else "Biomed on call"}
    maint = []
    for m in monitors:
        last_pm = datetime.fromisoformat(m["last_maintenance_at"])
        maint.append({"monitor_id": m["id"], "type": "preventive", "status": "completed",
                      "scheduled_for": last_pm.date().isoformat(), "completed_at": _iso(last_pm),
                      "description": "Semi-annual preventive maintenance and electrical safety test",
                      "resolution": "Passed all checks. NIBP calibrated within ±3 mmHg.", **tech_fields})
        if m["asset_tag"] in ("PM-1004", "PM-1008"):
            maint.append({"monitor_id": m["id"], "type": "inspection", "status": "scheduled",
                          "scheduled_for": (now + timedelta(days=5)).date().isoformat(),
                          "description": "Annual inspection due — coordinate with charge nurse", **tech_fields})
        if m["asset_tag"] == "PM-1010":
            maint.append({"monitor_id": m["id"], "type": "corrective", "status": "in_progress",
                          "scheduled_for": (now - timedelta(days=1)).date().isoformat(),
                          "description": "Intermittent NIBP pump error E-214 reported by SDU nursing",
                          "resolution": "Replacement pump ordered from vendor (simulated RMA #RMA-55821).", **tech_fields})
    insert_many("maintenance_records", maint)

    # --- events / state ------------------------------------------------------------------
    events.sort(key=lambda e: e["occurred_at"])
    insert_many("events", events)
    table("sim_state").update({"tick": 0, "sim_time": _iso(now), "running": False, "last_advanced_at": None,
                               "tick_seconds": 5, "updated_at": _iso(now)}).eq("id", 1).execute()
    log_event("demo_reset", "Demo data reset: 12 patients, 10 monitors, 2 hours of history",
              source="user" if actor else "system", actor=actor)
    return {"wards": len(WARDS), "beds": len(bed_by_label), "patients": len(patients), "monitors": len(monitors),
            "readings": len(readings), "alarms": len(alarms)}
