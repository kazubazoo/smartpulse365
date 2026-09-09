-- Run this in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query).
-- Safe to re-run: every statement is idempotent.

-- ---------------------------------------------------------------------------
-- Per-user dashboard settings (thresholds, time range, gauge ranges)
-- ---------------------------------------------------------------------------
create table if not exists public.user_settings (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  settings   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

-- Row Level Security: without these policies the table is readable by nobody.
-- auth.uid() is the id of the caller's JWT, so each policy is self-scoping.
drop policy if exists "read own settings" on public.user_settings;
create policy "read own settings"
  on public.user_settings for select
  using (auth.uid() = user_id);

drop policy if exists "insert own settings" on public.user_settings;
create policy "insert own settings"
  on public.user_settings for insert
  with check (auth.uid() = user_id);

drop policy if exists "update own settings" on public.user_settings;
create policy "update own settings"
  on public.user_settings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- Machine registry
--
-- Unlike settings, machines describe the plant itself, so every signed-in
-- operator sees the same list. The id is the machine_id tag written into
-- InfluxDB by the acquisition flow — that string is what links a row here to
-- its telemetry.
-- ---------------------------------------------------------------------------
create table if not exists public.machines (
  id          text primary key
                check (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  name        text not null,
  location    text default '',
  notes       text default '',
  -- Acquisition settings: protocol, host, port, unit id, poll interval,
  -- measurement name. Held as jsonb so fields can be added without a migration.
  source      jsonb not null default '{}'::jsonb,
  -- Analytic configuration for THIS asset: which vibration standard applies,
  -- the machine details that select the right class within it, the derived
  -- alarm limits, anomaly-detector tuning and gauge full-scale values.
  --
  -- These live on the machine rather than on the operator because they are
  -- properties of the equipment: a 200 kW compressor and a 2 kW fan do not
  -- share an alarm limit, and the ISO class is decided by the machine's power
  -- and mounting, not by who is looking at it. Display preferences stay in
  -- user_settings. jsonb so new fields need no migration.
  thresholds  jsonb not null default '{}'::jsonb,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Existing deployments: add the column without touching any data.
alter table public.machines
  add column if not exists thresholds jsonb not null default '{}'::jsonb;

alter table public.machines enable row level security;

-- Any signed-in operator may read and manage the machine list. Tighten to a
-- role check here if you later need view-only accounts.
drop policy if exists "read machines" on public.machines;
create policy "read machines"
  on public.machines for select
  to authenticated
  using (true);

drop policy if exists "insert machines" on public.machines;
create policy "insert machines"
  on public.machines for insert
  to authenticated
  with check (true);

drop policy if exists "update machines" on public.machines;
create policy "update machines"
  on public.machines for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "delete machines" on public.machines;
create policy "delete machines"
  on public.machines for delete
  to authenticated
  using (true);

-- Seed the machines this deployment already has telemetry for. Existing rows
-- are left untouched so re-running never clobbers edits made in the UI.
insert into public.machines (id, name, location, source) values
  ('motor01', 'Motor 01', 'Demo Kit', '{"protocol":"modbus-tcp","host":"192.168.0.30","port":502,"unit_id":1,"poll_ms":1000,"measurement":"motor_metrics"}'::jsonb),
  ('motor02', 'Motor 02', 'Demo Kit', '{"protocol":"modbus-tcp","host":"192.168.0.31","port":502,"unit_id":1,"poll_ms":1000,"measurement":"motor_metrics"}'::jsonb),
  ('motor03', 'Motor 03', 'Demo Kit', '{"protocol":"modbus-tcp","host":"192.168.0.32","port":502,"unit_id":1,"poll_ms":1000,"measurement":"motor_metrics"}'::jsonb),
  ('motor04', 'Motor 04', 'Demo Kit', '{"protocol":"modbus-tcp","host":"192.168.0.33","port":502,"unit_id":1,"poll_ms":1000,"measurement":"motor_metrics"}'::jsonb)
on conflict (id) do nothing;
