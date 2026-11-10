"""Create the demo staff accounts (idempotent) and load the demo dataset.

Usage (from the api/ folder, with .env configured):
    python -m scripts.seed_users            # users + demo data
    python -m scripts.seed_users --users    # users only
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from acme.db.client import get_client, table  # noqa: E402
from acme.services.seed_data import reset_demo_data  # noqa: E402

DEMO_PASSWORD = os.environ.get("DEMO_PASSWORD", "AcmeDemo2026!")

USERS = [
    ("admin@acme-clinical.test", "Alex Morgan", "admin", "Clinical Systems Administrator"),
    ("nurse@acme-clinical.test", "Jamie Carter", "nurse", "Charge Nurse, ICU"),
    ("nurse2@acme-clinical.test", "Riley Chen", "nurse", "Registered Nurse, Step-Down"),
    ("physician@acme-clinical.test", "Dr. Evan Brooks", "physician", "Intensivist"),
    ("physician2@acme-clinical.test", "Dr. Priya Raman", "physician", "Cardiologist"),
    ("biomed@acme-clinical.test", "Sam Patel", "biomed", "Biomedical Equipment Technician"),
]


def ensure_users() -> None:
    auth = get_client().auth.admin
    existing = {u.email: u for u in auth.list_users(page=1, per_page=200)}
    for email, name, role, title in USERS:
        if email in existing:
            uid = existing[email].id
            print(f"  = {email} already exists")
        else:
            res = auth.create_user({"email": email, "password": DEMO_PASSWORD, "email_confirm": True,
                                    "user_metadata": {"full_name": name}, "app_metadata": {"role": role}})
            uid = res.user.id
            print(f"  + created {email} ({role})")
        table("profiles").update({"full_name": name, "role": role, "title": title, "is_active": True}).eq("id", uid).execute()


if __name__ == "__main__":
    print("Creating demo staff accounts...")
    ensure_users()
    if "--users" not in sys.argv:
        print("Loading demo data (12 patients, 10 monitors)...")
        print(reset_demo_data())
    print(f"Done. Demo password for all accounts: {DEMO_PASSWORD}")
