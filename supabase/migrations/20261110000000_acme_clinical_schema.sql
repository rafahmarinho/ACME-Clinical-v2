-- ACME Clinical — core schema
-- Reads are allowed to authenticated users (needed for Realtime + direct reads);
-- all writes go through the FastAPI backend using the service role key.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('nurse', 'physician', 'biomed', 'admin');
create type public.vital_param as enum ('hr', 'spo2', 'rr', 'sbp', 'dbp');
create type public.sim_scenario as enum ('normal', 'low_spo2', 'low_battery', 'sensor_fault', 'connection_loss');

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role public.user_role not null default 'nurse',
  title text,
  phone text,
  avatar_url text,
  is_active boolean not null default true,
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Role is taken from app_metadata (only settable with the service role), never from user_metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    coalesce((new.raw_app_meta_data ->> 'role')::public.user_role, 'nurse')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Facility
-- ---------------------------------------------------------------------------
create table public.wards (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  floor text,
  description text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.beds (
  id uuid primary key default gen_random_uuid(),
  ward_id uuid not null references public.wards (id) on delete cascade,
  label text not null,
  pos_x real not null default 0,
  pos_z real not null default 0,
  created_at timestamptz not null default now(),
  unique (ward_id, label)
);

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  mrn text not null unique,
  first_name text not null,
  last_name text not null,
  date_of_birth date not null,
  sex text not null check (sex in ('female', 'male', 'other')),
  bed_id uuid unique references public.beds (id) on delete set null,
  admitted_at timestamptz not null default now(),
  diagnosis text not null default '',
  attending_physician text,
  acuity text not null default 'moderate' check (acuity in ('low', 'moderate', 'high', 'critical')),
  allergies text[] not null default '{}',
  code_status text not null default 'Full code',
  status text not null default 'admitted' check (status in ('admitted', 'discharged')),
  baseline jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Devices
-- ---------------------------------------------------------------------------
create table public.monitors (
  id uuid primary key default gen_random_uuid(),
  serial_number text not null unique,
  asset_tag text not null unique,
  model text not null,
  manufacturer text not null,
  firmware text not null,
  bed_id uuid unique references public.beds (id) on delete set null,
  status text not null default 'available' check (status in ('in_use', 'available', 'maintenance', 'retired')),
  connection text not null default 'online' check (connection in ('online', 'offline')),
  sensor_status text not null default 'ok' check (sensor_status in ('ok', 'fault')),
  battery_level real not null default 100,
  scenario public.sim_scenario not null default 'normal',
  last_seen_at timestamptz,
  last_maintenance_at timestamptz,
  next_maintenance_due date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Latest snapshot per monitor (drives the live screens via Realtime)
create table public.monitor_state (
  monitor_id uuid primary key references public.monitors (id) on delete cascade,
  patient_id uuid references public.patients (id) on delete set null,
  hr real,
  spo2 real,
  rr real,
  sbp real,
  dbp real,
  map real,
  battery_level real,
  signal_quality text not null default 'good',
  ecg jsonb not null default '[]'::jsonb,
  ecg_sample_rate int not null default 125,
  tick bigint not null default 0,
  recorded_at timestamptz not null default now()
);

create table public.vital_readings (
  id bigint generated always as identity primary key,
  monitor_id uuid not null references public.monitors (id) on delete cascade,
  patient_id uuid references public.patients (id) on delete cascade,
  recorded_at timestamptz not null,
  hr real,
  spo2 real,
  rr real,
  sbp real,
  dbp real,
  map real,
  battery_level real,
  signal_quality text not null default 'good',
  tick bigint not null default 0
);
create index vital_readings_patient_time on public.vital_readings (patient_id, recorded_at desc);
create index vital_readings_monitor_time on public.vital_readings (monitor_id, recorded_at desc);

-- ---------------------------------------------------------------------------
-- Alarm limits & alarms
-- ---------------------------------------------------------------------------
-- patient_id null = unit-wide default limits
create table public.alarm_thresholds (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references public.patients (id) on delete cascade,
  parameter public.vital_param not null,
  low real,
  high real,
  enabled boolean not null default true,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (low is null or high is null or low < high)
);
create unique index alarm_thresholds_default_uq on public.alarm_thresholds (parameter) where patient_id is null;
create unique index alarm_thresholds_patient_uq on public.alarm_thresholds (patient_id, parameter) where patient_id is not null;

create table public.alarms (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid references public.monitors (id) on delete cascade,
  patient_id uuid references public.patients (id) on delete cascade,
  bed_id uuid references public.beds (id) on delete set null,
  kind text not null check (kind in ('physiological', 'technical')),
  type text not null,
  priority text not null check (priority in ('high', 'medium', 'low')),
  message text not null,
  value real,
  threshold real,
  -- 'active' while the condition persists; 'cleared' once the simulator sees it resolve.
  state text not null default 'active' check (state in ('active', 'cleared')),
  started_at timestamptz not null,
  last_seen_at timestamptz not null,
  cleared_at timestamptz,
  -- Acknowledgement is independent from the condition: it silences, it does not resolve.
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.profiles (id) on delete set null,
  acknowledged_by_name text,
  ack_note text,
  created_at timestamptz not null default now()
);
create index alarms_state_idx on public.alarms (state, started_at desc);
create index alarms_patient_idx on public.alarms (patient_id, started_at desc);
create unique index alarms_one_active_per_condition on public.alarms (monitor_id, type) where state = 'active';

-- ---------------------------------------------------------------------------
-- Clinical documentation & maintenance
-- ---------------------------------------------------------------------------
create table public.observations (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  author_name text not null,
  author_role public.user_role,
  category text not null check (category in ('assessment', 'intervention', 'medication', 'note', 'escalation')),
  note text not null,
  vitals jsonb,
  created_at timestamptz not null default now()
);
create index observations_patient_idx on public.observations (patient_id, created_at desc);

create table public.maintenance_records (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid not null references public.monitors (id) on delete cascade,
  type text not null check (type in ('preventive', 'corrective', 'calibration', 'battery_replacement', 'inspection')),
  status text not null default 'scheduled' check (status in ('scheduled', 'in_progress', 'completed', 'cancelled')),
  scheduled_for date not null,
  completed_at timestamptz,
  technician_id uuid references public.profiles (id) on delete set null,
  technician_name text,
  description text not null,
  resolution text,
  attachment_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index maintenance_monitor_idx on public.maintenance_records (monitor_id, scheduled_for desc);

-- ---------------------------------------------------------------------------
-- Simulation, events, integrations, reports, settings
-- ---------------------------------------------------------------------------
create table public.sim_state (
  id int primary key default 1 check (id = 1),
  tick bigint not null default 0,
  sim_time timestamptz not null default now(),
  running boolean not null default false,
  tick_seconds int not null default 5,
  last_advanced_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  tick bigint,
  source text not null check (source in ('simulation', 'user', 'system', 'integration')),
  type text not null,
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  message text not null,
  monitor_id uuid references public.monitors (id) on delete set null,
  patient_id uuid references public.patients (id) on delete set null,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_name text,
  payload jsonb not null default '{}'::jsonb
);
create index events_time_idx on public.events (occurred_at desc);

-- Simulated outbound integrations (pager / SMS / e-mail / EHR)
create table public.integration_messages (
  id bigint generated always as identity primary key,
  channel text not null check (channel in ('pager', 'sms', 'email', 'ehr')),
  recipient text not null,
  subject text not null,
  body text not null,
  status text not null default 'delivered' check (status in ('queued', 'delivered', 'failed')),
  alarm_id uuid references public.alarms (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('alarm_summary', 'patient_vitals', 'device_status')),
  title text not null,
  params jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  csv_path text,
  pdf_path text,
  created_by uuid references public.profiles (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now()
);

create table public.system_settings (
  id int primary key default 1 check (id = 1),
  facility_name text not null default 'ACME General Hospital',
  paging_enabled boolean not null default true,
  escalation_minutes int not null default 2,
  battery_low_threshold int not null default 20,
  history_retention_hours int not null default 72,
  updated_at timestamptz not null default now()
);

insert into public.sim_state (id) values (1) on conflict do nothing;
insert into public.system_settings (id) values (1) on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','wards','beds','patients','monitors','monitor_state','vital_readings',
    'alarm_thresholds','alarms','observations','maintenance_records','sim_state','events',
    'integration_messages','reports','system_settings'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "authenticated can read %1$s" on public.%1$I for select to authenticated using (true)', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table
  public.monitor_state, public.monitors, public.alarms, public.events, public.sim_state, public.observations;

-- ---------------------------------------------------------------------------
-- Storage buckets
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp']),
  ('reports', 'reports', false, 10485760, array['text/csv', 'application/pdf']),
  ('maintenance', 'maintenance', false, 10485760, null)
on conflict (id) do nothing;

-- Users may manage only their own avatar folder: avatars/<uid>/...
create policy "avatar public read" on storage.objects for select using (bucket_id = 'avatars');
create policy "avatar own insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatar own update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatar own delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- reports/maintenance buckets: service role only (downloads via signed URLs issued by the API)
