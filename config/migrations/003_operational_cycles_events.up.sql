create table if not exists cycle_runs (
  id bigserial primary key,
  cycle_id text not null unique,
  signals_received integer not null,
  signals_accepted integer not null,
  signals_blocked integer not null,
  orders_submitted integer not null,
  orders_failed integer not null,
  orders_filled integer not null,
  reconciliation jsonb not null,
  status text not null,
  started_at timestamptz,
  finished_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_cycle_runs_finished_at on cycle_runs(finished_at desc);

create table if not exists operational_events (
  id bigserial primary key,
  event_type text not null,
  severity text not null,
  source text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_operational_events_created_at on operational_events(created_at desc);
create index if not exists idx_operational_events_event_type on operational_events(event_type);
