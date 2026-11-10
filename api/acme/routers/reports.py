from typing import Literal

from fastapi import APIRouter, Depends, HTTPException

from acme.core.security import CAN_REPORT, CurrentUser, require_roles
from acme.db.client import first, rows, table
from acme.schemas.models import ReportRequest
from acme.services import reports as svc

router = APIRouter(prefix="/reports", tags=["reports"])
can_report = require_roles(*CAN_REPORT)


@router.get("")
def list_reports(type: str | None = None, _: CurrentUser = Depends(can_report)):
    q = table("reports").select("*").order("created_at", desc=True).limit(100)
    if type:
        q = q.eq("type", type)
    return rows(q.execute())


@router.post("", status_code=201)
def create_report(body: ReportRequest, user: CurrentUser = Depends(can_report)):
    if user.role == "biomed" and body.type != "device_status":
        raise HTTPException(403, "Biomedical technicians can generate device reports only")
    return svc.generate(body.type, body.model_dump(exclude={"type"}), user)


@router.get("/{report_id}")
def get_report(report_id: str, _: CurrentUser = Depends(can_report)):
    r = first(table("reports").select("*").eq("id", report_id).execute())
    if not r:
        raise HTTPException(404, "Report not found")
    return r


@router.get("/{report_id}/download")
def download(report_id: str, format: Literal["csv", "pdf"] = "pdf", _: CurrentUser = Depends(can_report)):
    r = first(table("reports").select("csv_path,pdf_path").eq("id", report_id).execute())
    if not r:
        raise HTTPException(404, "Report not found")
    path = r["csv_path"] if format == "csv" else r["pdf_path"]
    if not path:
        raise HTTPException(404, "File not available")
    return {"url": svc.signed_url(path)}
