from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from acme.core.security import ANY_STAFF, CurrentUser, invalidate_user_cache, require_roles
from acme.db.client import first, get_client, rows, table
from acme.schemas.models import StaffCreate, StaffUpdate
from acme.services import integrations
from acme.services.events import log_event

router = APIRouter(prefix="/team", tags=["team"])
admin = require_roles("admin")


@router.get("")
def list_team(q: str | None = None, role: str | None = None, active: bool | None = None,
              _: CurrentUser = Depends(require_roles(*ANY_STAFF))):
    query = table("profiles").select("id,email,full_name,role,title,phone,avatar_url,is_active,created_at").order("full_name")
    if role:
        query = query.eq("role", role)
    if active is not None:
        query = query.eq("is_active", active)
    out = rows(query.execute())
    if q:
        out = [p for p in out if q.lower() in f"{p['full_name']} {p['email']} {p['title'] or ''}".lower()]
    return out


@router.post("", status_code=201)
def create_staff(body: StaffCreate, user: CurrentUser = Depends(admin)):
    try:
        res = get_client().auth.admin.create_user({
            "email": body.email, "password": body.password, "email_confirm": True,
            "user_metadata": {"full_name": body.full_name}, "app_metadata": {"role": body.role},
        })
    except Exception as exc:
        msg = str(exc)
        if "already" in msg.lower():
            raise HTTPException(409, "A user with this e-mail already exists")
        raise HTTPException(400, f"Could not create user: {msg}")
    uid = res.user.id
    prof = first(table("profiles").update({"full_name": body.full_name, "role": body.role, "title": body.title})
                 .eq("id", uid).execute())
    integrations.send([integrations.welcome_email(body.email, body.full_name)])
    log_event("staff_created", f"Account created for {body.full_name} ({body.role})", actor=user)
    return prof


@router.patch("/{user_id}")
def update_staff(user_id: str, body: StaffUpdate, user: CurrentUser = Depends(admin)):
    target = first(table("profiles").select("*").eq("id", user_id).execute())
    if not target:
        raise HTTPException(404, "Staff member not found")
    data = body.model_dump(exclude_unset=True)
    if user_id == user.id and (data.get("role", "admin") != "admin" or data.get("is_active") is False):
        raise HTTPException(409, "You cannot remove your own administrator access")
    auth_admin = get_client().auth.admin
    if "role" in data:
        auth_admin.update_user_by_id(user_id, {"app_metadata": {"role": data["role"]}})
    if "is_active" in data:
        auth_admin.update_user_by_id(user_id, {"ban_duration": "none" if data["is_active"] else "876000h"})
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    upd = first(table("profiles").update(data).eq("id", user_id).execute())
    invalidate_user_cache()
    changes = ", ".join(f"{k}={v}" for k, v in data.items() if k != "updated_at")
    log_event("staff_updated", f"{target['full_name']}: {changes}", actor=user)
    return upd
