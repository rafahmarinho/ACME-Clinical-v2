"""Monitors (devices), bed binding and maintenance tracking."""

import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from acme.core.security import ANY_STAFF, CAN_BIND, DEVICE_ADMIN, CurrentUser, require_roles
from acme.db.client import first, get_client, rows, table
from acme.schemas.models import BindMonitor, MaintenanceCreate, MaintenanceUpdate, MonitorUpdate
from acme.services.directory import Directory
from acme.services.events import log_event

router = APIRouter(tags=["devices"])
staff = require_roles(*ANY_STAFF)
MAX_UPLOAD = 10 * 1024 * 1024


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.get("/monitors")
def list_monitors(q: str | None = None, status: str | None = None, model: str | None = None,
                  connection: str | None = None, _: CurrentUser = Depends(staff)):
    d = Directory()
    open_wo = {}
    for r in rows(table("maintenance_records").select("monitor_id,status").in_("status", ["scheduled", "in_progress"]).execute()):
        open_wo[r["monitor_id"]] = open_wo.get(r["monitor_id"], 0) + 1
    today = datetime.now(timezone.utc).date().isoformat()
    out = []
    for m in d.monitors.values():
        if status and m["status"] != status:
            continue
        if model and m["model"] != model:
            continue
        if connection and m["connection"] != connection:
            continue
        bed = d.bed_brief(m["bed_id"])
        pat = d.patient_brief(d.patient_by_bed.get(m["bed_id"])) if m["bed_id"] else None
        if q and q.lower() not in f"{m['asset_tag']} {m['serial_number']} {m['model']} {(bed or {}).get('label', '')}".lower():
            continue
        tech = [a for a in d.active_alarms if a["monitor_id"] == m["id"] and a["kind"] == "technical"]
        out.append({**m, "bed": bed, "patient": pat, "open_work_orders": open_wo.get(m["id"], 0),
                    "maintenance_overdue": bool(m["next_maintenance_due"] and m["next_maintenance_due"] < today),
                    "technical_alarms": [{"type": a["type"], "priority": a["priority"], "message": a["message"]} for a in tech]})
    return out


@router.get("/monitors/{monitor_id}")
def get_monitor(monitor_id: str, _: CurrentUser = Depends(staff)):
    d = Directory()
    m = d.monitors.get(monitor_id)
    if not m:
        raise HTTPException(404, "Monitor not found")
    maint = rows(table("maintenance_records").select("*").eq("monitor_id", monitor_id).order("scheduled_for", desc=True).execute())
    alarms = rows(table("alarms").select("*").eq("monitor_id", monitor_id).eq("kind", "technical")
                  .order("started_at", desc=True).limit(20).execute())
    events = rows(table("events").select("*").eq("monitor_id", monitor_id).order("occurred_at", desc=True).limit(30).execute())
    st = d.state_brief(monitor_id)
    return {**m, "bed": d.bed_brief(m["bed_id"]),
            "patient": d.patient_brief(d.patient_by_bed.get(m["bed_id"])) if m["bed_id"] else None,
            "state": st, "maintenance": maint, "technical_alarms": alarms, "events": events}


@router.post("/monitors/{monitor_id}/bind")
def bind_monitor(monitor_id: str, body: BindMonitor, user: CurrentUser = Depends(require_roles(*CAN_BIND))):
    m = first(table("monitors").select("*").eq("id", monitor_id).execute())
    if not m:
        raise HTTPException(404, "Monitor not found")
    now = _now()
    if body.bed_id is None:  # unbind
        if not m["bed_id"]:
            raise HTTPException(409, "Monitor is not linked to a bed")
        bed = first(table("beds").select("label").eq("id", m["bed_id"]).execute())
        table("monitors").update({"bed_id": None, "status": "available", "updated_at": now}).eq("id", monitor_id).execute()
        # Monitoring has ended: close the monitor's open conditions.
        table("alarms").update({"state": "cleared", "cleared_at": now}).eq("monitor_id", monitor_id).eq("state", "active").execute()
        table("monitor_state").delete().eq("monitor_id", monitor_id).execute()
        log_event("monitor_unbound", f"{m['asset_tag']} unlinked from bed {bed['label'] if bed else ''}", actor=user,
                  monitor_id=monitor_id)
        return first(table("monitors").select("*").eq("id", monitor_id).execute())

    if m["status"] in ("maintenance", "retired"):
        raise HTTPException(409, f"{m['asset_tag']} is in {m['status']} and cannot be linked to a bed")
    bed = first(table("beds").select("*").eq("id", body.bed_id).execute())
    if not bed:
        raise HTTPException(404, "Bed not found")
    taken = first(table("monitors").select("asset_tag").eq("bed_id", body.bed_id).neq("id", monitor_id).execute())
    if taken:
        raise HTTPException(409, f"Bed {bed['label']} already has monitor {taken['asset_tag']}")
    if m["bed_id"] and m["bed_id"] != body.bed_id:
        table("alarms").update({"state": "cleared", "cleared_at": now}).eq("monitor_id", monitor_id).eq("state", "active").execute()
    table("monitors").update({"bed_id": body.bed_id, "status": "in_use", "connection": "online",
                              "last_seen_at": now, "updated_at": now}).eq("id", monitor_id).execute()
    pat = first(table("patients").select("id,first_name,last_name").eq("bed_id", body.bed_id).eq("status", "admitted").execute())
    table("monitor_state").upsert({"monitor_id": monitor_id, "patient_id": pat["id"] if pat else None,
                                   "battery_level": m["battery_level"], "signal_quality": "good", "ecg": [],
                                   "recorded_at": now}).execute()
    who = f" ({pat['first_name']} {pat['last_name']})" if pat else ""
    log_event("monitor_bound", f"{m['asset_tag']} linked to bed {bed['label']}{who}", actor=user, monitor_id=monitor_id,
              patient_id=pat["id"] if pat else None)
    return first(table("monitors").select("*").eq("id", monitor_id).execute())


@router.patch("/monitors/{monitor_id}")
def update_monitor(monitor_id: str, body: MonitorUpdate, user: CurrentUser = Depends(require_roles(*DEVICE_ADMIN))):
    m = first(table("monitors").select("*").eq("id", monitor_id).execute())
    if not m:
        raise HTTPException(404, "Monitor not found")
    data = body.model_dump(exclude_unset=True, mode="json")
    if data.get("status") in ("maintenance", "retired", "available") and m["bed_id"]:
        raise HTTPException(409, "Unlink the monitor from its bed first")
    if data.get("status") == "in_use" and not m["bed_id"]:
        raise HTTPException(409, "Link the monitor to a bed to put it in use")
    if data.get("status") == "available":
        data["connection"] = "online"
    if data.get("status") == "maintenance":
        data["connection"] = "offline"
    data["updated_at"] = _now()
    upd = first(table("monitors").update(data).eq("id", monitor_id).execute())
    log_event("monitor_updated", f"{m['asset_tag']} updated", actor=user, monitor_id=monitor_id, payload=data)
    return upd


# --------------------------------------------------------------------------- maintenance
@router.get("/maintenance")
def list_maintenance(status: str | None = None, type: str | None = None, monitor_id: str | None = None,
                     _: CurrentUser = Depends(staff)):
    q = table("maintenance_records").select("*").order("scheduled_for", desc=True).limit(300)
    if status:
        q = q.eq("status", status)
    if type:
        q = q.eq("type", type)
    if monitor_id:
        q = q.eq("monitor_id", monitor_id)
    mons = {m["id"]: m for m in rows(table("monitors").select("id,asset_tag,model,serial_number").execute())}
    return [{**r, "monitor": mons.get(r["monitor_id"])} for r in rows(q.execute())]


@router.post("/maintenance", status_code=201)
def create_maintenance(body: MaintenanceCreate, user: CurrentUser = Depends(require_roles(*DEVICE_ADMIN))):
    m = first(table("monitors").select("id,asset_tag").eq("id", body.monitor_id).execute())
    if not m:
        raise HTTPException(404, "Monitor not found")
    rec = first(table("maintenance_records").insert({
        **body.model_dump(mode="json"), "status": "scheduled", "technician_id": user.id, "technician_name": user.display,
    }).execute())
    log_event("maintenance_scheduled", f"{body.type.replace('_', ' ').title()} scheduled for {m['asset_tag']} on {body.scheduled_for}",
              actor=user, monitor_id=m["id"])
    return rec


@router.patch("/maintenance/{record_id}")
def update_maintenance(record_id: str, body: MaintenanceUpdate, user: CurrentUser = Depends(require_roles(*DEVICE_ADMIN))):
    rec = first(table("maintenance_records").select("*").eq("id", record_id).execute())
    if not rec:
        raise HTTPException(404, "Maintenance record not found")
    data = body.model_dump(exclude_unset=True, mode="json")
    now = _now()
    data["updated_at"] = now
    if data.get("status") == "completed":
        data["completed_at"] = now
        data["technician_id"], data["technician_name"] = user.id, user.display
    upd = first(table("maintenance_records").update(data).eq("id", record_id).execute())
    mon = first(table("monitors").select("*").eq("id", rec["monitor_id"]).execute())
    if data.get("status") == "completed" and mon:
        mupd = {"last_maintenance_at": now, "updated_at": now}
        if rec["type"] in ("preventive", "inspection", "calibration"):
            mupd["next_maintenance_due"] = (datetime.now(timezone.utc) + timedelta(days=180)).date().isoformat()
        if rec["type"] == "battery_replacement":
            mupd["battery_level"] = 100
        table("monitors").update(mupd).eq("id", mon["id"]).execute()
    if data.get("status") == "in_progress" and mon and not mon["bed_id"] and mon["status"] == "available":
        table("monitors").update({"status": "maintenance", "connection": "offline", "updated_at": now}).eq("id", mon["id"]).execute()
    if "status" in body.model_fields_set:
        log_event("maintenance_updated", f"Work order for {mon['asset_tag'] if mon else 'monitor'} is now {data['status'].replace('_', ' ')}",
                  actor=user, monitor_id=rec["monitor_id"])
    return upd


@router.post("/maintenance/{record_id}/attachment")
async def upload_attachment(record_id: str, file: UploadFile = File(...),
                            user: CurrentUser = Depends(require_roles(*DEVICE_ADMIN))):
    rec = first(table("maintenance_records").select("id,monitor_id").eq("id", record_id).execute())
    if not rec:
        raise HTTPException(404, "Maintenance record not found")
    data = await file.read()
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "File is larger than 10 MB")
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", file.filename or "attachment")[:80]
    path = f"{record_id}/{safe}"
    get_client().storage.from_("maintenance").upload(path, data, {"content-type": file.content_type or "application/octet-stream",
                                                                 "upsert": "true"})
    upd = first(table("maintenance_records").update({"attachment_path": path, "updated_at": _now()}).eq("id", record_id).execute())
    log_event("maintenance_attachment", f"Service document “{safe}” attached", actor=user, monitor_id=rec["monitor_id"])
    return upd


@router.get("/maintenance/{record_id}/attachment")
def attachment_url(record_id: str, _: CurrentUser = Depends(staff)):
    rec = first(table("maintenance_records").select("attachment_path").eq("id", record_id).execute())
    if not rec or not rec["attachment_path"]:
        raise HTTPException(404, "No attachment")
    res = get_client().storage.from_("maintenance").create_signed_url(rec["attachment_path"], 300)
    return {"url": res.get("signedURL") or res.get("signedUrl")}
