from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from acme.core.security import ANY_STAFF, CAN_EDIT_LIMITS, CurrentUser, require_roles
from acme.db.client import first, rows, table
from acme.schemas.models import ThresholdSet
from acme.services.events import log_event

router = APIRouter(prefix="/thresholds", tags=["alarm limits"])


@router.get("")
def list_thresholds(_: CurrentUser = Depends(require_roles(*ANY_STAFF))):
    items = rows(table("alarm_thresholds").select("*").execute())
    patients = {p["id"]: p for p in rows(table("patients").select("id,first_name,last_name,mrn,bed_id").eq("status", "admitted").execute())}
    beds = {b["id"]: b["label"] for b in rows(table("beds").select("id,label").execute())}
    defaults = sorted([t for t in items if not t["patient_id"]], key=lambda t: t["parameter"])
    overrides: dict[str, dict] = {}
    for t in items:
        if t["patient_id"] and t["patient_id"] in patients:
            p = patients[t["patient_id"]]
            entry = overrides.setdefault(p["id"], {"patient_id": p["id"], "patient_name": f"{p['first_name']} {p['last_name']}",
                                                   "mrn": p["mrn"], "bed": beds.get(p["bed_id"] or ""), "limits": []})
            entry["limits"].append(t)
    return {"defaults": defaults, "patients": sorted(overrides.values(), key=lambda e: e["bed"] or "ZZZ")}


def _upsert(patient_id: str | None, body: ThresholdSet, user: CurrentUser) -> list[dict]:
    now = datetime.now(timezone.utc).isoformat()
    out = []
    for item in body.items:
        q = table("alarm_thresholds").select("id").eq("parameter", item.parameter)
        q = q.eq("patient_id", patient_id) if patient_id else q.is_("patient_id", "null")
        existing = first(q.execute())
        data = {**item.model_dump(), "updated_by": user.id, "updated_at": now}
        if existing:
            out.append(first(table("alarm_thresholds").update(data).eq("id", existing["id"]).execute()))
        else:
            out.append(first(table("alarm_thresholds").insert({**data, "patient_id": patient_id}).execute()))
    return out


@router.put("/defaults")
def set_defaults(body: ThresholdSet, user: CurrentUser = Depends(require_roles(*CAN_EDIT_LIMITS))):
    res = _upsert(None, body, user)
    log_event("limits_changed", "Unit default alarm limits updated: " + ", ".join(i.parameter.upper() for i in body.items),
              actor=user, payload=body.model_dump())
    return res


@router.put("/patients/{patient_id}")
def set_patient_limits(patient_id: str, body: ThresholdSet, user: CurrentUser = Depends(require_roles(*CAN_EDIT_LIMITS))):
    p = first(table("patients").select("id,first_name,last_name").eq("id", patient_id).execute())
    if not p:
        raise HTTPException(404, "Patient not found")
    res = _upsert(patient_id, body, user)
    log_event("limits_changed", f"Custom alarm limits for {p['first_name']} {p['last_name']}: "
              + ", ".join(i.parameter.upper() for i in body.items), actor=user, patient_id=patient_id, payload=body.model_dump())
    return res


@router.delete("/patients/{patient_id}/{parameter}", status_code=204)
def reset_patient_limit(patient_id: str, parameter: str, user: CurrentUser = Depends(require_roles(*CAN_EDIT_LIMITS))):
    table("alarm_thresholds").delete().eq("patient_id", patient_id).eq("parameter", parameter).execute()
    log_event("limits_changed", f"{parameter.upper()} limit reverted to unit default", actor=user, patient_id=patient_id)
