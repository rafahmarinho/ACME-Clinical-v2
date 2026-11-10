from fastapi import APIRouter, Depends, HTTPException, Query

from acme.core.security import ANY_STAFF, SIM_ADMIN, CurrentUser, require_roles
from acme.db.client import rows, table
from acme.schemas.models import AdvanceRequest, BulkScenarioRequest, RunningRequest, ScenarioRequest
from acme.services import seed_data, simulation
from acme.services.directory import Directory
from acme.services.engine import SCENARIOS

router = APIRouter(tags=["simulation"])
staff = require_roles(*ANY_STAFF)
sim_admin = require_roles(*SIM_ADMIN)


@router.get("/simulation")
def get_simulation(_: CurrentUser = Depends(staff)):
    d = Directory(with_state=True)
    monitors = []
    for m in d.monitors.values():
        pat = d.patient_by_bed.get(m["bed_id"]) if m["bed_id"] else None
        monitors.append({**d.monitor_brief(m), "bed": d.bed_brief(m["bed_id"]), "patient": d.patient_brief(pat),
                         "simulated": bool(m["bed_id"] and m["status"] == "in_use")})
    return {"state": simulation.get_state(), "scenarios": [{"id": k, "label": v} for k, v in SCENARIOS.items()],
            "monitors": monitors}


@router.post("/simulation/advance")
def advance(body: AdvanceRequest, user: CurrentUser = Depends(sim_admin)):
    return simulation.advance(body.ticks, mode="manual", actor=user)


@router.post("/simulation/tick")
def live_tick(_: CurrentUser = Depends(staff)):
    """Called by open clients while the live simulation is running (server de-duplicates)."""
    return simulation.advance(1, mode="live")


@router.put("/simulation/running")
def set_running(body: RunningRequest, user: CurrentUser = Depends(sim_admin)):
    return simulation.set_running(body.running, user)


@router.put("/simulation/monitors/{monitor_id}/scenario")
def set_scenario(monitor_id: str, body: ScenarioRequest, user: CurrentUser = Depends(sim_admin)):
    return simulation.set_scenario(monitor_id, body.scenario, user)


@router.post("/simulation/scenario")
def set_bulk(body: BulkScenarioRequest, user: CurrentUser = Depends(sim_admin)):
    return [simulation.set_scenario(mid, body.scenario, user) for mid in body.monitor_ids]


@router.post("/simulation/reset")
def reset(user: CurrentUser = Depends(require_roles("admin", "biomed"))):
    return seed_data.reset_demo_data(user)


@router.get("/events")
def list_events(
    source: str | None = None,
    severity: str | None = None,
    type: str | None = None,
    monitor_id: str | None = None,
    patient_id: str | None = None,
    q: str | None = None,
    before: int | None = None,
    limit: int = Query(100, ge=1, le=500),
    _: CurrentUser = Depends(staff),
):
    query = table("events").select("*").order("id", desc=True).limit(limit)
    for col, val in (("source", source), ("severity", severity), ("type", type), ("monitor_id", monitor_id),
                     ("patient_id", patient_id)):
        if val:
            query = query.eq(col, val)
    if before:
        query = query.lt("id", before)
    if q:
        query = query.ilike("message", f"%{q.replace('%', '').replace(',', ' ')}%")
    return rows(query.execute())


@router.get("/integrations/messages")
def list_messages(channel: str | None = None, limit: int = Query(50, le=200), _: CurrentUser = Depends(staff)):
    q = table("integration_messages").select("*").order("id", desc=True).limit(limit)
    if channel:
        q = q.eq("channel", channel)
    return rows(q.execute())
