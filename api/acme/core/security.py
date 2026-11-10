"""Authentication (Supabase access tokens) and role-based authorization."""

import threading
import time
from dataclasses import dataclass
from typing import Callable

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from acme.db.client import first, get_client, table

bearer = HTTPBearer(auto_error=False)

ROLES = ("nurse", "physician", "biomed", "admin")


@dataclass(frozen=True)
class CurrentUser:
    id: str
    email: str
    full_name: str
    role: str

    @property
    def display(self) -> str:
        return self.full_name or self.email


_cache: dict[str, tuple[float, CurrentUser]] = {}
_lock = threading.Lock()
_TTL = 30.0


def _resolve(token: str) -> CurrentUser:
    now = time.monotonic()
    with _lock:
        hit = _cache.get(token)
        if hit and hit[0] > now:
            return hit[1]
    try:
        res = get_client().auth.get_user(token)
    except Exception:
        res = None
    if not res or not res.user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Your session has expired. Please sign in again.")
    profile = first(table("profiles").select("*").eq("id", res.user.id).limit(1).execute())
    if not profile:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No staff profile is linked to this account.")
    if not profile.get("is_active", True):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account has been deactivated.")
    user = CurrentUser(
        id=profile["id"], email=profile["email"], full_name=profile.get("full_name") or "", role=profile["role"]
    )
    with _lock:
        if len(_cache) > 500:
            _cache.clear()
        _cache[token] = (now + _TTL, user)
    return user


def invalidate_user_cache() -> None:
    with _lock:
        _cache.clear()


def get_current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> CurrentUser:
    if not creds or creds.scheme.lower() != "bearer":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentication required.")
    return _resolve(creds.credentials)


def require_roles(*roles: str) -> Callable[..., CurrentUser]:
    def dep(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have permission to perform this action.")
        return user

    return dep


# Permission groups used by the routers
CLINICAL = ("nurse", "physician", "admin")
ANY_STAFF = ROLES
CAN_ACK = ("nurse", "physician", "biomed", "admin")
CAN_EDIT_LIMITS = ("physician", "admin")
CAN_BIND = ("nurse", "biomed", "admin")
DEVICE_ADMIN = ("biomed", "admin")
CAN_REPORT = ("physician", "biomed", "admin")
SIM_ADMIN = ("biomed", "admin")
