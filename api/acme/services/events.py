"""Event log (simulation, user actions, system, simulated integrations)."""

from datetime import datetime, timezone

from acme.core.security import CurrentUser
from acme.db.client import insert_many, table


def make_event(
    type: str,
    message: str,
    *,
    source: str = "user",
    severity: str = "info",
    monitor_id: str | None = None,
    patient_id: str | None = None,
    actor: CurrentUser | None = None,
    tick: int | None = None,
    occurred_at: datetime | None = None,
    payload: dict | None = None,
) -> dict:
    return {
        "type": type,
        "message": message,
        "source": source,
        "severity": severity,
        "monitor_id": monitor_id,
        "patient_id": patient_id,
        "actor_id": actor.id if actor else None,
        "actor_name": actor.display if actor else None,
        "tick": tick,
        "occurred_at": (occurred_at or datetime.now(timezone.utc)).isoformat(),
        "payload": payload or {},
    }


def log_event(*args, **kwargs) -> None:
    table("events").insert(make_event(*args, **kwargs)).execute()


def log_events(events: list[dict]) -> None:
    if events:
        insert_many("events", events)
