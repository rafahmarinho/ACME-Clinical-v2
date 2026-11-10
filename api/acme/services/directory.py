"""Read-model assembly shared by several endpoints (joins done in Python over small reference tables)."""

from __future__ import annotations

from datetime import date

from acme.db.client import rows, table

PRIORITY_RANK = {"low": 0, "medium": 1, "high": 2}


def age(dob: str) -> int:
    d = date.fromisoformat(dob)
    t = date.today()
    return t.year - d.year - ((t.month, t.day) < (d.month, d.day))


class Directory:
    """Snapshot of wards, beds, patients, monitors, live state and active alarms."""

    def __init__(self, *, with_state: bool = True, with_alarms: bool = True, include_discharged: bool = False):
        self.wards = {w["id"]: w for w in rows(table("wards").select("*").order("sort_order").execute())}
        self.beds = {b["id"]: b for b in rows(table("beds").select("*").order("label").execute())}
        pq = table("patients").select("*")
        if not include_discharged:
            pq = pq.eq("status", "admitted")
        self.patients = {p["id"]: p for p in rows(pq.execute())}
        self.monitors = {m["id"]: m for m in rows(table("monitors").select("*").order("asset_tag").execute())}
        self.patient_by_bed = {p["bed_id"]: p for p in self.patients.values() if p["bed_id"] and p["status"] == "admitted"}
        self.monitor_by_bed = {m["bed_id"]: m for m in self.monitors.values() if m["bed_id"]}
        self.state = (
            {s["monitor_id"]: s for s in rows(table("monitor_state").select("*").execute())} if with_state else {}
        )
        self.active_alarms: list[dict] = (
            rows(table("alarms").select("*").eq("state", "active").order("started_at", desc=True).execute())
            if with_alarms else []
        )

    # ---- helpers -------------------------------------------------------------------
    def alarm_summary(self, *, bed_id: str | None = None, patient_id: str | None = None) -> dict:
        items = [a for a in self.active_alarms
                 if (bed_id and a["bed_id"] == bed_id) or (patient_id and a["patient_id"] == patient_id)]
        highest = max((a["priority"] for a in items), key=lambda p: PRIORITY_RANK[p], default=None)
        return {
            "count": len(items),
            "unacknowledged": sum(1 for a in items if not a["acknowledged_at"]),
            "highest": highest,
            "items": [{"id": a["id"], "type": a["type"], "priority": a["priority"], "message": a["message"],
                       "acknowledged": bool(a["acknowledged_at"]), "kind": a["kind"]} for a in items],
        }

    def bed_brief(self, bed_id: str | None) -> dict | None:
        if not bed_id or bed_id not in self.beds:
            return None
        b = self.beds[bed_id]
        w = self.wards.get(b["ward_id"], {})
        return {"id": b["id"], "label": b["label"], "ward_id": b["ward_id"], "ward_code": w.get("code"),
                "ward_name": w.get("name")}

    def patient_brief(self, p: dict | None) -> dict | None:
        if not p:
            return None
        return {"id": p["id"], "mrn": p["mrn"], "first_name": p["first_name"], "last_name": p["last_name"],
                "full_name": f"{p['first_name']} {p['last_name']}", "age": age(p["date_of_birth"]), "sex": p["sex"],
                "acuity": p["acuity"], "diagnosis": p["diagnosis"], "code_status": p["code_status"]}

    def monitor_brief(self, m: dict | None) -> dict | None:
        if not m:
            return None
        return {k: m[k] for k in ("id", "asset_tag", "serial_number", "model", "status", "connection", "sensor_status",
                                  "battery_level", "scenario", "last_seen_at", "bed_id")}

    def state_brief(self, monitor_id: str | None) -> dict | None:
        s = self.state.get(monitor_id or "")
        if not s:
            return None
        return {k: s[k] for k in ("hr", "spo2", "rr", "sbp", "dbp", "map", "battery_level", "signal_quality",
                                  "recorded_at", "tick", "ecg", "ecg_sample_rate", "patient_id")}

    def patient_row(self, p: dict, *, include_ecg: bool = False) -> dict:
        mon = self.monitor_by_bed.get(p["bed_id"]) if p["bed_id"] else None
        st = self.state_brief(mon["id"]) if mon else None
        if st and st.get("patient_id") != p["id"]:
            st = None
        if st and not include_ecg:
            st = {k: v for k, v in st.items() if k != "ecg"}
        return {
            **self.patient_brief(p),
            "status": p["status"], "admitted_at": p["admitted_at"], "attending_physician": p["attending_physician"],
            "allergies": p["allergies"], "date_of_birth": p["date_of_birth"],
            "bed": self.bed_brief(p["bed_id"]), "monitor": self.monitor_brief(mon), "vitals": st,
            "alarms": self.alarm_summary(patient_id=p["id"]),
        }
