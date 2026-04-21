create table if not exists ingestion_runs (
  id bigserial primary key,
  status text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  checkpoint text,
  error_message text
);

create table if not exists markets (
  market_id text primary key,
  slug text,
  question text not null,
  active boolean not null default true,
  closed boolean not null default false,
  end_date timestamptz,
  raw jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_markets_updated_at on markets(updated_at desc);

create table if not exists orderbook_snapshots (
  id bigserial primary key,
  market_id text not null references markets(market_id) on delete cascade,
  token_id text not null,
  snapshot_time timestamptz not null,
  bids jsonb not null,
  asks jsonb not null,
  ingestion_run_id bigint references ingestion_runs(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_orderbook_snapshots_market_time
  on orderbook_snapshots(market_id, snapshot_time desc);

create table if not exists trade_ticks (
  id bigserial primary key,
  trade_id text not null unique,
  market_id text not null references markets(market_id) on delete cascade,
  token_id text not null,
  side text not null,
  price numeric(10, 6) not null,
  size numeric(18, 6) not null,
  traded_at timestamptz not null,
  ingestion_run_id bigint references ingestion_runs(id),
  raw jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_trade_ticks_market_time on trade_ticks(market_id, traded_at desc);
create index if not exists idx_trade_ticks_token_time on trade_ticks(token_id, traded_at desc);
