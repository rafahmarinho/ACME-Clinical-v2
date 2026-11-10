"""Supabase access (service role). All database writes in the system go through here."""

from functools import lru_cache
from typing import Any

from supabase import Client, create_client

from acme.core.config import get_settings


@lru_cache
def get_client() -> Client:
    s = get_settings()
    return create_client(s.supabase_url, s.supabase_service_role_key)


def table(name: str):
    return get_client().table(name)


def rows(resp: Any) -> list[dict]:
    return list(resp.data or [])


def first(resp: Any) -> dict | None:
    data = resp.data or []
    if isinstance(data, dict):
        return data
    return data[0] if data else None


def chunked(items: list[dict], size: int = 500):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def fetch_all(build, page: int = 1000, limit: int = 50000) -> list[dict]:
    """Page through a PostgREST query (the API caps each response at 1000 rows).

    `build` is a zero-arg callable returning a fresh, ordered query builder.
    """
    out: list[dict] = []
    start = 0
    while start < limit:
        chunk = rows(build().range(start, start + page - 1).execute())
        out.extend(chunk)
        if len(chunk) < page:
            break
        start += page
    return out


def insert_many(name: str, items: list[dict], size: int = 500) -> list[dict]:
    out: list[dict] = []
    for chunk in chunked(items, size):
        out.extend(rows(table(name).insert(chunk).execute()))
    return out
