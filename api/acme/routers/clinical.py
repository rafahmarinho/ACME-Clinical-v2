"""Wards, patients, observations, live monitoring and global search."""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from acme.core.security import ANY_STAFF, CLINICAL, CurrentUser, require_roles
from acme.db.client import fetch_all, first, rows, table
from acme.schemas.models import ObservationCreate
from acme.services import integrations
from acme.services.directory import Directory
from acme.services.engine import PARAMS
from acme.services.events import log_event
from acme.services.simulation import load_limits

router = APIRouter(tags=["clinical"])
staff = require_roles(*ANY_STAFF)


@router.get("/wards/overview")
def ward_overview(_: CurrentUser = Depends(staff)):
    d = Directory()
    wards = []
    for w in d.wards.values():
        beds = []
        for b in [b for b in d.beds.values() if b["ward_id"] == w["id"]]:
            pat = d.patient_by_bed.get(b["id"])
            mon = d.monitor_by_bed.get(b["id"])
            st = d.state_brief(mon["id"]) if mon else None
            if st:
                st.pop("ecg", None)
            beds.append({
                "id": b["id"], "label": b["label"], "pos_x": b["pos_x"], "pos_z": b["pos_z"],
                "patient": d.patient_brief(pat), "monitor": d.monitor_brief(mon),
                "vitals": st if st and pat and st["patient_id"] == pat["id"] else None,
                "alarms": d.alarm_summary(bed_id=b["id"]),
            })
        beds.sort(key=lambda x: x["label"])
        wards.append({
            **w, "beds": beds,
            "stats": {
                "beds": len(beds), "occupied": sum(1 for b in beds if b["patient"]),
                "monitored": sum(1 for b in beds if b["patient"] and b["monitor"]),
                "active_alarms": sum(b["alarms"]["count"] for b in beds),
                "unacknowledged": sum(b["alarms"]["unacknowledged"] for b in beds),
                "high_priority": sum(1 for b in beds for a in b["alarms"]["items"] if a["priority"] == "high"),
            },
        })
    return {"wards": wards}


@router.get("/beds")
def list_beds(free: bool = False, _: CurrentUser = Depends(staff)):
    d = Directory(with_state=False, with_alarms=False)
    out = []
    for b in d.beds.values():
        mon = d.monitor_by_bed.get(b["id"])
        if free and mon:
            continue
        out.append({**d.bed_brief(b["id"]), "patient": d.patient_brief(d.patient_by_bed.get(b["id"])),
                    "monitor": d.monitor_brief(mon)})
    return sorted(out, key=lambda x: x["label"])


@router.get("/patients")
def list_patients(
    q: str | None = None,
    ward_id: str | None = None,
    acuity: str | None = None,
    monitored: bool | None = None,
    alarm: bool | None = None,
    status: str = "admitted",
    _: CurrentUser = Depends(staff),
):
    d = Directory(include_discharged=status != "admitted")
    out = []
    for p in d.patients.values():
        if status != "all" and p["status"] != status:
            continue
        row = d.patient_row(p)
        if q:
            hay = f"{row['full_name']} {row['mrn']} {(row['bed'] or {}).get('label', '')} {row['diagnosis']}".lower()
            if q.lower() not in hay:
                continue
        if ward_id and (row["bed"] or {}).get("ward_id") != ward_id:
            continue
        if acuity and row["acuity"] != acuity:
            continue
        if monitored is not None and bool(row["monitor"]) != monitored:
            continue
        if alarm is not None and (row["alarms"]["count"] > 0) != alarm:
            continue
        out.append(row)
    out.sort(key=lambda r: ((r["bed"] or {}).get("label") or "ZZZ", r["last_name"]))
    return out


@router.get("/patients/{patient_id}")
def get_patient(patient_id: str, _: CurrentUser = Depends(staff)):
    d = Directory(include_discharged=True)
    p = d.patients.get(patient_id)
    if not p:
        raise HTTPException(404, "Patient not found")
    defaults, per_patient = load_limits()
    own = per_patient.get(patient_id, {})
    limits = {}
    for prm in PARAMS:
        src = own.get(prm) or defaults.get(prm)
        limits[prm] = {**(src or {"low": None, "high": None, "enabled": False}), "custom": prm in own}
    return {**d.patient_row(p, include_ecg=True), "baseline": p["baseline"], "limits": limits}


@router.get("/patients/{patient_id}/vitals")
def patient_vitals(patient_id: str, minutes: int = Query(60, ge=5, le=1440), points: int = Query(240, ge=20, le=1000),
                   _: CurrentUser = Depends(staff)):
    since = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()
    data = fetch_all(lambda: table("vital_readings").select("recorded_at,hr,spo2,rr,sbp,dbp,map")
                     .eq("patient_id", patient_id).gte("recorded_at", since).order("recorded_at"), limit=20000)
    if len(data) > points:  # bucket-average downsampling
        size = len(data) / points
        out = []
        for i in range(points):
            chunk = data[int(i * size): int((i + 1) * size)] or [data[min(int(i * size), len(data) - 1)]]
            row = {"recorded_at": chunk[-1]["recorded_at"]}
            for k in (*PARAMS, "map"):
                vals = [c[k] for c in chunk if c[k] is not None]
                row[k] = round(sum(vals) / len(vals), 1) if vals else None
            out.append(row)
        data = out
    return data


@router.get("/patients/{patient_id}/alarms")
def patient_alarms(patient_id: str, limit: int = Query(50, le=200), _: CurrentUser = Depends(staff)):
    return rows(table("alarms").select("*").eq("patient_id", patient_id).order("started_at", desc=True).limit(limit).execute())


@router.get("/patients/{patient_id}/observations")
def list_observations(patient_id: str, _: CurrentUser = Depends(staff)):
    return rows(table("observations").select("*").eq("patient_id", patient_id).order("created_at", desc=True).limit(100).execute())


@router.post("/patients/{patient_id}/observations", status_code=201)
def add_observation(patient_id: str, body: ObservationCreate, user: CurrentUser = Depends(require_roles(*CLINICAL))):
    p = first(table("patients").select("id,first_name,last_name,mrn,bed_id").eq("id", patient_id).execute())
    if not p:
        raise HTTPException(404, "Patient not found")
    vitals = None
    if body.include_vitals and p["bed_id"]:
        mon = first(table("monitors").select("id").eq("bed_id", p["bed_id"]).execute())
        if mon:
            st = first(table("monitor_state").select("hr,spo2,rr,sbp,dbp,map,recorded_at,patient_id")
                       .eq("monitor_id", mon["id"]).execute())
            if st and st.get("patient_id") == patient_id:
                st.pop("patient_id", None)
                vitals = st
    obs = first(table("observations").insert({
        "patient_id": patient_id, "author_id": user.id, "author_name": user.display, "author_role": user.role,
        "category": body.category, "note": body.note.strip(), "vitals": vitals,
    }).execute())
    name = f"{p['first_name']} {p['last_name']}"
    integrations.send([integrations.ehr_observation_export(name, p["mrn"], body.note)])
    log_event("observation_recorded", f"{body.category.title()} recorded for {name}", actor=user, patient_id=patient_id)
    return obs


@router.get("/monitoring/live")
def live(ward_id: str | None = None, _: CurrentUser = Depends(staff)):
    d = Directory()
    tiles = []
    for b in d.beds.values():
        mon = d.monitor_by_bed.get(b["id"])
        if not mon or (ward_id and b["ward_id"] != ward_id):
            continue
        pat = d.patient_by_bed.get(b["id"])
        st = d.state_brief(mon["id"])
        tiles.append({
            "bed": d.bed_brief(b["id"]), "monitor": d.monitor_brief(mon), "patient": d.patient_brief(pat),
            "vitals": st if st and pat and st["patient_id"] == pat["id"] else None,
            "alarms": d.alarm_summary(bed_id=b["id"]),
        })
    tiles.sort(key=lambda t: t["bed"]["label"])
    return tiles


@router.get("/search")
def search(q: str = Query(min_length=2, max_length=80), _: CurrentUser = Depends(staff)):
    d = Directory(with_state=False)
    ql = q.lower()
    patients = [d.patient_row(p) for p in d.patients.values()
                if ql in f"{p['first_name']} {p['last_name']} {p['mrn']} {p['diagnosis']}".lower()]
    monitors = [{**d.monitor_brief(m), "bed": d.bed_brief(m["bed_id"])} for m in d.monitors.values()
                if ql in f"{m['asset_tag']} {m['serial_number']} {m['model']}".lower()]
    beds = [{**d.bed_brief(b["id"]), "patient": d.patient_brief(d.patient_by_bed.get(b["id"]))}
            for b in d.beds.values() if ql in b["label"].lower()]
    return {"patients": patients[:10], "monitors": monitors[:10], "beds": beds[:10]}
