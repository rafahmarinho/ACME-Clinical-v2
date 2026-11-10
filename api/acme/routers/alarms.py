from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from acme.core.security import ANY_STAFF, CAN_ACK, CurrentUser, require_roles
from acme.db.client import first, rows, table
from acme.schemas.models import AckAlarm
from acme.services.directory import Directory
from acme.services.events import log_event

router = APIRouter(prefix="/alarms", tags=["alarms"])


@router.get("")
def list_alarms(
    state: Literal["active", "cleared", "all"] = "active",
    priority: str | None = None,
    kind: str | None = None,
    ward_id: str | None = None,
    acknowledged: bool | None = None,
    q: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    _: CurrentUser = Depends(require_roles(*ANY_STAFF)),
):
    query = table("alarms").select("*").order("started_at", desc=True).limit(limit)
    if state != "all":
        query = query.eq("state", state)
    if priority:
        query = query.eq("priority", priority)
    if kind:
        query = query.eq("kind", kind)
    if acknowledged is True:
        query = query.not_.is_("acknowledged_at", "null")
    elif acknowledged is False:
        query = query.is_("acknowledged_at", "null")
    alarms = rows(query.execute())
    d = Directory(with_state=False, with_alarms=False, include_discharged=True)
    out = []
    for a in alarms:
        bed = d.bed_brief(a["bed_id"])
        if ward_id and (bed or {}).get("ward_id") != ward_id:
            continue
        pat = d.patient_brief(d.patients.get(a["patient_id"] or ""))
        mon = d.monitors.get(a["monitor_id"] or "")
        row = {**a, "bed": bed, "patient": pat, "monitor": {"id": mon["id"], "asset_tag": mon["asset_tag"]} if mon else None}
        if q:
            hay = f"{a['message']} {a['type']} {(pat or {}).get('full_name', '')} {(bed or {}).get('label', '')}".lower()
            if q.lower() not in hay:
                continue
        out.append(row)
    rank = {"high": 0, "medium": 1, "low": 2}
    if state == "active":  # unacknowledged + highest priority first
        out.sort(key=lambda a: (bool(a["acknowledged_at"]), rank[a["priority"]], a["started_at"]), reverse=False)
    return out


@router.get("/counts")
def counts(_: CurrentUser = Depends(require_roles(*ANY_STAFF))):
    active = rows(table("alarms").select("priority,acknowledged_at,kind").eq("state", "active").execute())
    return {
        "active": len(active),
        "unacknowledged": sum(1 for a in active if not a["acknowledged_at"]),
        "high": sum(1 for a in active if a["priority"] == "high"),
        "high_unacknowledged": sum(1 for a in active if a["priority"] == "high" and not a["acknowledged_at"]),
        "technical": sum(1 for a in active if a["kind"] == "technical"),
    }


@router.post("/{alarm_id}/acknowledge")
def acknowledge(alarm_id: str, body: AckAlarm, user: CurrentUser = Depends(require_roles(*CAN_ACK))):
    a = first(table("alarms").select("*").eq("id", alarm_id).execute())
    if not a:
        raise HTTPException(404, "Alarm not found")
    if a["acknowledged_at"]:
        raise HTTPException(409, f"Already acknowledged by {a['acknowledged_by_name'] or 'another user'}")
    # Acknowledging records the response; it does NOT change `state`. The alarm stays active
    # until the simulator observes that the underlying condition has resolved.
    upd = first(table("alarms").update({
        "acknowledged_at": datetime.now(timezone.utc).isoformat(), "acknowledged_by": user.id,
        "acknowledged_by_name": user.display, "ack_note": (body.note or "").strip() or None,
    }).eq("id", alarm_id).is_("acknowledged_at", "null").execute())
    if not upd:
        raise HTTPException(409, "Alarm was acknowledged by someone else")
    still = " (condition still present)" if a["state"] == "active" else ""
    log_event("alarm_acknowledged", f"Alarm acknowledged{still}: {a['message']}", actor=user,
              monitor_id=a["monitor_id"], patient_id=a["patient_id"], payload={"alarm_id": alarm_id, "note": body.note})
    return upd
