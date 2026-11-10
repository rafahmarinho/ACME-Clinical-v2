"""Simulated external integrations.

Nothing leaves the system: messages are written to `integration_messages` as if a
paging gateway / SMS provider / e-mail relay / EHR interface had accepted them.
"""

from acme.db.client import insert_many


def page_for_alarm(alarm: dict, bed_label: str | None, patient_name: str | None) -> dict:
    where = f"Bed {bed_label}" if bed_label else "Unassigned bed"
    return {
        "channel": "pager",
        "recipient": "Charge Nurse pager #4410",
        "subject": f"HIGH PRIORITY — {where}",
        "body": f"{alarm['message']} — {patient_name or 'Unknown patient'}",
        "status": "delivered",
        "alarm_id": alarm["id"],
    }


def ehr_observation_export(patient_name: str, mrn: str, note: str) -> dict:
    return {
        "channel": "ehr",
        "recipient": "EHR interface (HL7 ORU^R01)",
        "subject": f"Observation for {patient_name} ({mrn})",
        "body": note[:500],
        "status": "delivered",
    }


def welcome_email(email: str, full_name: str) -> dict:
    return {
        "channel": "email",
        "recipient": email,
        "subject": "Your ACME Clinical account is ready",
        "body": f"Hello {full_name}, an administrator created your ACME Clinical account. "
        "Use the temporary password provided by your administrator and change it from your profile.",
        "status": "delivered",
    }


def send(messages: list[dict]) -> None:
    if messages:
        insert_many("integration_messages", messages)
