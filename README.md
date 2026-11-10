# ACME Clinical

Patient-monitoring central station: ward overview (2D and 3D), patient list and detail, live monitoring with a synthetic ECG, alarms, devices and maintenance, alarm limits, reports, team management, and a Simulation Lab.

All patients are fictitious and all monitors are simulated. External integrations (pager, e-mail and EHR) are simulated too: messages are written to the `integration_messages` table and appear under **Simulation Lab → Integrations**.

| Layer | Stack |
|---|---|
| Web (`web/`) | React 19, Vite 8, TypeScript, Tailwind CSS 4, TanStack Query, React Router, Recharts, React Three Fiber, pnpm |
| API (`api/`) | Python 3.12+, FastAPI, Pydantic v2, supabase-py, ReportLab |
| Data (`supabase/`) | Supabase Postgres, Auth (e-mail and password), Storage, Realtime |

## Architecture

```
Browser (web/)                      FastAPI (api/)                     Supabase
───────────────                     ──────────────                     ────────
Supabase Auth  ── login / reset ──────────────────────────────────────▶ auth
REST calls with the user's JWT ───▶ verifies the token and loads the role
                                    services/engine.py: vitals, ECG,
                                      alarm rules (pure Python)
                                    services/simulation.py: ticks ────▶ Postgres (service role)
                                    services/reports.py: CSV + PDF ───▶ Storage "reports"
Realtime subscriptions ◀──────────────────────────────────────────────── monitor_state, alarms, …
Avatar upload ─────────────────────────────────────────────────────────▶ Storage "avatars"
```

* **The API does all writes**, using the service-role key. Row Level Security is on for every table. Signed-in users get read-only access, which Realtime and the simulation clock need.
* **Readings, alarms and reports are generated in Python.** `api/acme/services/engine.py` has no I/O, so it is unit-tested on its own.
* **Live mode:** Vercel functions can't run background loops. While the simulation is running, every open browser calls `POST /simulation/tick` every 5 s, and the API ignores ticks that arrive less than 4 s apart. The clock therefore advances once per interval however many people are watching. Results reach every screen through Supabase Realtime.
* **Alarm semantics:**
  * An alarm stays `active` while its condition lasts.
  * **Acknowledging** records who responded, when and with what note. It does **not** end the alarm.
  * Only the simulator clears an alarm, once the condition has resolved. Hysteresis stops alarms from flapping on and off at a limit.
  * Missing data (offline monitor, faulty probe) never counts as proof that a condition has ended.
* **Concurrency:** ticks update only the columns the simulator owns, through `apply_monitor_telemetry` and `apply_alarm_updates`. A scenario change or acknowledgement made during a tick is never overwritten.

### Project layout

```
api/
  index.py                  Vercel entrypoint (exposes `app`)
  acme/main.py              FastAPI app, CORS, error handlers
  acme/core/                settings, auth and role checks
  acme/db/client.py         Supabase data access helpers
  acme/schemas/models.py    Pydantic request models
  acme/routers/             me, clinical, alarms, devices, thresholds, reports, team, simulation
  acme/services/            engine, ecg, simulation, seed_data, reports, integrations, events, directory
  scripts/seed_users.py     demo accounts and demo dataset
  tests/test_engine.py      simulator and alarm-rule tests
web/
  src/pages/                screens (auth, wards, patients, live, alarms, devices, maintenance, limits, reports, team, simulation, profile, settings, search)
  src/components/           ui kit, layout, vitals (ECG, tiles, trends), 3D ward, dialogs
  src/services/             API clients by domain
  src/hooks/                realtime sync, simulation driver, alarm tone
  src/lib/                  api client, supabase client, roles and navigation, formatting
supabase/
  migrations/               schema, RLS, storage buckets, realtime, RPCs
  config.toml               local stack (ports 566xx, sign-ups disabled)
```

### Roles

| Area | Nurse | Physician | Biomed tech | Admin |
|---|:-:|:-:|:-:|:-:|
| Ward overview, live monitoring, alarms (acknowledge) | ✓ | ✓ | ✓ | ✓ |
| Patients and observations | ✓ | ✓ | – | ✓ |
| Alarm limits | view | edit | – | edit |
| Devices: link or unlink monitors to beds | ✓ | – | ✓ | ✓ |
| Maintenance, device edits | – | – | ✓ | ✓ |
| Reports | – | ✓ | devices only | ✓ |
| Simulation Lab (scenarios, advance, reset) | – | – | ✓ | ✓ |
| Team management, system settings | – | – | – | ✓ |

The API enforces each permission. The web app adapts its navigation to the signed-in role and guards each route.

## Demo data

* **Patients and beds:** 2 wards (ICU with 8 beds, Cardiac Step-Down with 6 beds) and **12 patients**. 4 Step-Down patients start without a monitor, so you can link one.
* **Monitors:** **10 monitors**. 8 are in use, 1 is available (PM-1009) and 1 is in maintenance (PM-1010).
* **History:** two hours of readings, with scripted past episodes (desaturation, connection drop, probe fault, low battery), observations and maintenance history.
* **Patient-specific limits:** SpO₂ ≥ 88 for the COPD patient, HR ≤ 130 for the DKA patient.

**Demo accounts** (password `AcmeDemo2026!`, or the value of `DEMO_PASSWORD` when you seed). These are local and demo credentials only; change them for any shared environment.

| Role | E-mail |
|---|---|
| Admin | admin@acme-clinical.test |
| Nurse | nurse@acme-clinical.test, nurse2@acme-clinical.test |
| Physician | physician@acme-clinical.test, physician2@acme-clinical.test |
| Biomed tech | biomed@acme-clinical.test |

### Simulation scenarios

| Scenario | Effect |
|---|---|
| Normal readings | Vitals drift around the patient's baseline. The battery recharges. |
| Low oxygen saturation | SpO₂ falls toward about 84%, and HR and RR rise. Raises a physiological alarm. |
| Low battery | The battery drains 2.5% per tick. Raises a technical alarm below 20% (configurable). |
| Sensor problem | SpO₂ becomes invalid (shown as `--`). Raises a technical alarm. |
| Connection loss | No data reaches the station, and the tile greys out. Raises a technical alarm. |

In **Simulation Lab** you can:

* select monitors and apply a scenario;
* advance the simulation by 1 tick, 1 minute or 5 minutes;
* start or pause live mode;
* filter the event log;
* inspect the simulated integration messages;
* **reset the demo data**, which keeps staff accounts.

## Run locally

Prerequisites: Docker Desktop, Node 20+ with pnpm, and Python 3.12+.

**1. Start Supabase.** This applies the migrations automatically:

```bash
npx supabase@latest start -x edge-runtime,logflare,vector,imgproxy,supavisor
```

The command prints the API URL (`http://127.0.0.1:56621`), the anon key and the service-role key. Mailpit, which receives password-reset e-mails, runs at http://127.0.0.1:56624.

**2. Start the API.** Copy `api/.env.example` to `api/.env` and fill in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Then:

```bash
cd api
python -m venv .venv
.venv/Scripts/activate        # Windows; use `source .venv/bin/activate` on macOS/Linux
pip install -r requirements-dev.txt
python -m scripts.seed_users  # creates the demo accounts and the demo dataset
uvicorn acme.main:app --port 8010 --reload --reload-dir acme
python -m pytest -q           # engine tests
```

Interactive API docs: http://127.0.0.1:8010/docs

**3. Start the web app.** Copy `web/.env.example` to `web/.env.local` and set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_API_URL=http://127.0.0.1:8010`. Then:

```bash
cd web
pnpm install
pnpm dev
```

Open http://localhost:5173 and sign in with a demo account. As admin or biomed, open **Simulation Lab** and press **Start live**.

## Deploy to Vercel

The web app and the API are **two separate Vercel projects** from the same repository.

### 1. Supabase (cloud)

1. Create a project at supabase.com.
2. Apply the migrations, either with `npx supabase link --project-ref <ref>` followed by `npx supabase db push`, or by pasting the files in `supabase/migrations/` into the SQL editor in order.
3. Under **Authentication → Providers → Email**, keep e-mail and password enabled. Under **Authentication → Settings**, turn off **Allow new users to sign up**: administrators create accounts from the Team page.
4. Under **Authentication → URL Configuration**:
   * set **Site URL** to your web URL (for example `https://acme-clinical.vercel.app`);
   * add `https://acme-clinical.vercel.app/reset-password` to **Redirect URLs**.
5. Seed the cloud project from your machine: point `api/.env` at the cloud project, set `DEMO_PASSWORD` to a strong value, and run `python -m scripts.seed_users`.

### 2. API project (`api/`)

1. In Vercel, create a new project from this repository and set **Root Directory** to `api`. The FastAPI preset is detected from `index.py`, and dependencies come from `requirements.txt`.
2. Set these environment variables:
   * `SUPABASE_URL`
   * `SUPABASE_SERVICE_ROLE_KEY` (server-only; never expose it to the browser)
   * `CORS_ORIGINS=https://<your-web-domain>`
   * `ENVIRONMENT=production`
3. Deploy, then check `https://<api-domain>/health`.

CLI alternative: `cd api && vercel --prod`.

### 3. Web project (`web/`)

1. Create a second Vercel project from the same repository and set **Root Directory** to `web`. `web/vercel.json` sets up the pnpm build, the `dist` output and the SPA rewrites.
2. Set these environment variables:
   * `VITE_SUPABASE_URL`
   * `VITE_SUPABASE_ANON_KEY` (anon or publishable key)
   * `VITE_API_URL=https://<api-domain>`
3. Deploy. If the web domain changes, update `CORS_ORIGINS` on the API project and the Supabase URL configuration.

CLI alternative: `cd web && vercel --prod`.

## Verified flows

These were checked against a local Supabase stack:

* Sign-in for each role, role-based navigation, forbidden-route guard, and blocked sign-in for a deactivated account.
* Password-reset e-mail delivered (Mailpit).
* Each scenario raises the expected alarm.
* An acknowledged alarm stays active until its condition resolves, then clears automatically.
* Concurrent ticks never overwrite scenario changes or acknowledgements (36 of 36 in a stress test).
* Linking a spare monitor to a bed starts readings for that patient.
* Observations, limit changes (including validation), maintenance with a file attachment, the three report types (PDF and CSV download), staff creation, and search.
* Data persists after a reload.
