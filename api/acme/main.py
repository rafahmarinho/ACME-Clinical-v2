import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from acme.core.config import get_settings
from acme.routers import alarms, clinical, devices, me, reports, simulation, team, thresholds

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("acme")
settings = get_settings()

app = FastAPI(title=settings.app_name, version="1.0.0", docs_url="/docs", redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.exception_handler(RequestValidationError)
async def validation_handler(_: Request, exc: RequestValidationError):
    msgs = []
    for e in exc.errors():
        loc = ".".join(str(p) for p in e.get("loc", []) if p not in ("body", "query", "path"))
        msg = str(e.get("msg", "Invalid value")).removeprefix("Value error, ")
        msgs.append(f"{loc}: {msg}" if loc else msg)
    return JSONResponse(status_code=422, content={"detail": "; ".join(msgs) or "Invalid request"})


@app.exception_handler(Exception)
async def unhandled(_: Request, exc: Exception):
    log.exception("Unhandled error: %s", exc)
    return JSONResponse(status_code=500, content={"detail": "Unexpected server error. Please try again."})


@app.get("/health", tags=["system"])
def health():
    return {"status": "ok", "service": settings.app_name}


for r in (me.router, clinical.router, alarms.router, devices.router, thresholds.router, reports.router, team.router,
          simulation.router):
    app.include_router(r)
