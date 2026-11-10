from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from acme.core.security import CurrentUser, get_current_user, invalidate_user_cache, require_roles
from acme.db.client import first, table
from acme.schemas.models import Preferences, ProfileUpdate, SystemSettingsUpdate
from acme.services.events import log_event

router = APIRouter(tags=["profile & settings"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.get("/me")
def me(user: CurrentUser = Depends(get_current_user)):
    p = first(table("profiles").select("*").eq("id", user.id).execute())
    p["preferences"] = Preferences(**(p.get("preferences") or {})).model_dump()
    return p


@router.patch("/me")
def update_me(body: ProfileUpdate, user: CurrentUser = Depends(get_current_user)):
    data = body.model_dump(exclude_unset=True)
    data["updated_at"] = _now()
    p = first(table("profiles").update(data).eq("id", user.id).execute())
    invalidate_user_cache()
    log_event("profile_updated", f"{user.display} updated their profile", actor=user)
    return p


@router.put("/me/preferences")
def update_preferences(body: Preferences, user: CurrentUser = Depends(get_current_user)):
    p = first(table("profiles").update({"preferences": body.model_dump(), "updated_at": _now()}).eq("id", user.id).execute())
    return p["preferences"]


@router.get("/settings/system")
def get_system_settings(_: CurrentUser = Depends(get_current_user)):
    return first(table("system_settings").select("*").eq("id", 1).execute())


@router.put("/settings/system")
def update_system_settings(body: SystemSettingsUpdate, user: CurrentUser = Depends(require_roles("admin"))):
    s = first(table("system_settings").update({**body.model_dump(), "updated_at": _now()}).eq("id", 1).execute())
    log_event("settings_updated", "System settings updated", actor=user, payload=body.model_dump())
    return s
