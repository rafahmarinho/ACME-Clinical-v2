"""Report generation (aggregation in Python, CSV + PDF stored in Supabase Storage)."""

from __future__ import annotations

import csv
import io
import statistics
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from acme.core.security import CurrentUser
from acme.db.client import fetch_all, first, get_client, rows, table
from acme.services.engine import PARAMS, PARAM_LABEL
from acme.services.events import log_event

BUCKET = "reports"
NAVY = colors.HexColor("#0B1F44")
TITLES = {
    "alarm_summary": "Alarm Summary",
    "patient_vitals": "Patient Vital Signs Summary",
    "device_status": "Device Status & Maintenance",
}


def _fmt(v, nd: int = 0):
    if v is None:
        return "—"
    return f"{v:.{nd}f}" if isinstance(v, float) else str(v)


def _context():
    beds = {b["id"]: b for b in rows(table("beds").select("id,label,ward_id").execute())}
    wards = {w["id"]: w for w in rows(table("wards").select("id,code,name").execute())}
    patients = {p["id"]: p for p in rows(table("patients").select("id,mrn,first_name,last_name,bed_id").execute())}
    return beds, wards, patients


def _in_ward(bed_id, ward_id, beds) -> bool:
    return not ward_id or (bed_id in beds and beds[bed_id]["ward_id"] == ward_id)


def alarm_summary(hours: int, ward_id: str | None) -> tuple[dict, list[str], list[list]]:
    beds, wards, patients = _context()
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    alarms = [a for a in fetch_all(lambda: table("alarms").select("*").gte("started_at", since).order("started_at"))
              if _in_ward(a["bed_id"], ward_id, beds)]
    ack_times = []
    for a in alarms:
        if a["acknowledged_at"]:
            d = (datetime.fromisoformat(a["acknowledged_at"]) - datetime.fromisoformat(a["started_at"])).total_seconds()
            ack_times.append(max(0.0, d))
    by_bed = Counter(beds.get(a["bed_id"], {}).get("label", "Unassigned") for a in alarms)
    summary = {
        "total": len(alarms),
        "active": sum(a["state"] == "active" for a in alarms),
        "acknowledged_pct": round(100 * len(ack_times) / len(alarms), 1) if alarms else 0,
        "mean_time_to_ack_s": round(statistics.mean(ack_times), 1) if ack_times else None,
        "median_time_to_ack_s": round(statistics.median(ack_times), 1) if ack_times else None,
        "by_priority": dict(Counter(a["priority"] for a in alarms)),
        "by_kind": dict(Counter(a["kind"] for a in alarms)),
        "by_type": dict(Counter(a["type"] for a in alarms).most_common()),
        "top_beds": by_bed.most_common(5),
    }
    header = ["Started", "Bed", "Patient", "Type", "Priority", "Kind", "Message", "State", "Acknowledged", "Ack by", "Cleared"]
    table_rows = []
    for a in alarms:
        p = patients.get(a["patient_id"] or "")
        table_rows.append([
            a["started_at"][:19].replace("T", " "), beds.get(a["bed_id"], {}).get("label", "—"),
            f"{p['last_name']}, {p['first_name']}" if p else "—", a["type"], a["priority"], a["kind"], a["message"],
            a["state"], (a["acknowledged_at"] or "")[:19].replace("T", " "), a["acknowledged_by_name"] or "",
            (a["cleared_at"] or "")[:19].replace("T", " "),
        ])
    return summary, header, table_rows


def patient_vitals(hours: int, ward_id: str | None, patient_id: str | None) -> tuple[dict, list[str], list[list]]:
    beds, wards, patients = _context()
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()

    def q():
        b = table("vital_readings").select("patient_id,hr,spo2,rr,sbp,dbp").gte("recorded_at", since).order("id")
        return b.eq("patient_id", patient_id) if patient_id else b

    readings = fetch_all(q, limit=200000)
    grouped: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for r in readings:
        if not r["patient_id"]:
            continue
        for p in PARAMS:
            if r[p] is not None:
                grouped[r["patient_id"]][p].append(r[p])
    alarm_counts = Counter(a["patient_id"] for a in fetch_all(
        lambda: table("alarms").select("patient_id").eq("kind", "physiological").gte("started_at", since).order("id")))
    header = ["Bed", "Patient", "MRN", "Readings"]
    for p in PARAMS:
        header += [f"{p.upper()} min", f"{p.upper()} mean", f"{p.upper()} max"]
    header.append("Physiological alarms")
    out_rows, per_patient = [], []
    for pid, vals in grouped.items():
        pat = patients.get(pid)
        if not pat or not _in_ward(pat["bed_id"], ward_id, beds):
            continue
        n = max((len(v) for v in vals.values()), default=0)
        stats = {p: (min(vals[p]), statistics.mean(vals[p]), max(vals[p])) if vals[p] else (None, None, None) for p in PARAMS}
        bed = beds.get(pat["bed_id"] or "", {}).get("label", "—")
        row = [bed, f"{pat['last_name']}, {pat['first_name']}", pat["mrn"], n]
        for p in PARAMS:
            row += [_fmt(stats[p][0]), _fmt(stats[p][1], 1), _fmt(stats[p][2])]
        row.append(alarm_counts.get(pid, 0))
        out_rows.append(row)
        per_patient.append({"patient_id": pid, "name": row[1], "bed": bed, "readings": n,
                            "alarms": alarm_counts.get(pid, 0),
                            "mean": {p: (round(stats[p][1], 1) if stats[p][1] is not None else None) for p in PARAMS}})
    out_rows.sort(key=lambda r: r[0])
    per_patient.sort(key=lambda r: r["bed"])
    return {"patients": len(out_rows), "readings": len(readings), "per_patient": per_patient}, header, out_rows


def device_status() -> tuple[dict, list[str], list[list]]:
    beds, _, _ = _context()
    monitors = rows(table("monitors").select("*").order("asset_tag").execute())
    open_wo = Counter(m["monitor_id"] for m in rows(
        table("maintenance_records").select("monitor_id").in_("status", ["scheduled", "in_progress"]).execute()))
    since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    tech = Counter(a["monitor_id"] for a in fetch_all(
        lambda: table("alarms").select("monitor_id").eq("kind", "technical").gte("started_at", since).order("id")))
    today = datetime.now(timezone.utc).date().isoformat()
    header = ["Asset tag", "Serial", "Model", "Firmware", "Status", "Bed", "Connection", "Battery %", "Last seen",
              "Next PM due", "Overdue", "Open work orders", "Technical alarms (24h)"]
    out = []
    for m in monitors:
        overdue = bool(m["next_maintenance_due"] and m["next_maintenance_due"] < today)
        out.append([m["asset_tag"], m["serial_number"], m["model"], m["firmware"], m["status"],
                    beds.get(m["bed_id"] or "", {}).get("label", "—"), m["connection"], round(m["battery_level"]),
                    (m["last_seen_at"] or "")[:19].replace("T", " "), m["next_maintenance_due"] or "—",
                    "Yes" if overdue else "No", open_wo.get(m["id"], 0), tech.get(m["id"], 0)])
    summary = {
        "total": len(monitors),
        "by_status": dict(Counter(m["status"] for m in monitors)),
        "offline": sum(m["connection"] == "offline" and m["status"] == "in_use" for m in monitors),
        "low_battery": sum(m["battery_level"] < 20 for m in monitors),
        "maintenance_overdue": sum(r[10] == "Yes" for r in out),
        "open_work_orders": sum(open_wo.values()),
    }
    return summary, header, out


def _csv(header, data) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    w.writerows(data)
    return buf.getvalue().encode("utf-8")


def _pdf(title: str, subtitle: str, summary_lines: list[str], header, data) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=28, rightMargin=28, topMargin=28, bottomMargin=28,
                            title=title, author="ACME Clinical")
    ss = getSampleStyleSheet()
    ss["Title"].textColor = NAVY
    small = ss["BodyText"].clone("small", fontSize=7, leading=8.5, textColor=NAVY)
    story = [Paragraph(f"ACME Clinical — {title}", ss["Title"]), Paragraph(subtitle, ss["Normal"]), Spacer(1, 8)]
    for line in summary_lines:
        story.append(Paragraph(line, ss["Normal"]))
    story.append(Spacer(1, 10))
    if data:
        body = [[Paragraph(str(h), small) for h in header]] + [[Paragraph(str(c), small) for c in r] for r in data[:600]]
        t = Table(body, repeatRows=1)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E8EEF8")),
            ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#C5D0E3")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]))
        story.append(t)
    else:
        story.append(Paragraph("No data for the selected period.", ss["Normal"]))
    doc.build(story)
    return buf.getvalue()


def _summary_lines(kind: str, s: dict) -> list[str]:
    if kind == "alarm_summary":
        mtta = f"{s['mean_time_to_ack_s']:.0f} s" if s["mean_time_to_ack_s"] is not None else "—"
        return [f"<b>Total alarms:</b> {s['total']} &nbsp; <b>Active:</b> {s['active']} &nbsp; "
                f"<b>Acknowledged:</b> {s['acknowledged_pct']}% &nbsp; <b>Mean time to acknowledge:</b> {mtta}",
                "<b>By priority:</b> " + ", ".join(f"{k}: {v}" for k, v in s["by_priority"].items())]
    if kind == "patient_vitals":
        return [f"<b>Patients:</b> {s['patients']} &nbsp; <b>Readings analysed:</b> {s['readings']}"]
    return [f"<b>Monitors:</b> {s['total']} &nbsp; <b>Offline in use:</b> {s['offline']} &nbsp; "
            f"<b>Low battery:</b> {s['low_battery']} &nbsp; <b>PM overdue:</b> {s['maintenance_overdue']} &nbsp; "
            f"<b>Open work orders:</b> {s['open_work_orders']}"]


def generate(kind: str, params: dict, actor: CurrentUser) -> dict:
    hours = int(params.get("hours") or 24)
    ward_id = params.get("ward_id") or None
    if kind == "alarm_summary":
        summary, header, data = alarm_summary(hours, ward_id)
    elif kind == "patient_vitals":
        summary, header, data = patient_vitals(hours, ward_id, params.get("patient_id") or None)
    elif kind == "device_status":
        summary, header, data = device_status()
    else:
        raise HTTPException(422, "Unknown report type")

    rid = str(uuid.uuid4())
    title = TITLES[kind]
    ward_name = None
    if ward_id:
        w = first(table("wards").select("name").eq("id", ward_id).execute())
        ward_name = w["name"] if w else None
    scope = ward_name or "All wards"
    period = "Current snapshot" if kind == "device_status" else f"Last {hours} hours"
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    subtitle = f"{scope} · {period} · Generated {generated} by {actor.display}"

    store = get_client().storage.from_(BUCKET)
    csv_path, pdf_path = f"{rid}/{kind}.csv", f"{rid}/{kind}.pdf"
    store.upload(csv_path, _csv(header, data), {"content-type": "text/csv", "upsert": "true"})
    store.upload(pdf_path, _pdf(title, subtitle, _summary_lines(kind, summary), header, data),
                 {"content-type": "application/pdf", "upsert": "true"})

    summary["rows"] = len(data)
    rec = first(table("reports").insert({
        "id": rid, "type": kind, "title": f"{title} — {scope}", "params": {**params, "hours": hours},
        "summary": summary, "csv_path": csv_path, "pdf_path": pdf_path, "created_by": actor.id,
        "created_by_name": actor.display,
    }).execute())
    log_event("report_generated", f"{title} generated ({scope}, {period.lower()})", actor=actor, payload={"report_id": rid})
    return rec  # type: ignore[return-value]


def signed_url(path: str, expires: int = 300) -> str:
    res = get_client().storage.from_(BUCKET).create_signed_url(path, expires)
    url = res.get("signedURL") or res.get("signedUrl") or res.get("signed_url")
    if not url:
        raise HTTPException(502, "Could not create a download link")
    return url
