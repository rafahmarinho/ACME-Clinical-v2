"""Vercel entrypoint: exposes the FastAPI ASGI app."""

from acme.main import app

__all__ = ["app"]
