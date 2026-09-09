-- OPTRANE website verification bridge and Agentcess broker mirror.
create table if not exists public.desktop_auth_requests (
  id uuid primary key default gen_random_uuid(),
  verifier_hash text not null,
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','DENIED','EXPIRED','CONSUMED')),
  callback_uri text not null default 'optrane://auth/callback',
  user_id uuid references auth.users(id) on delete cascade,
  email text,
  token_hash text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  approved_at timestamptz,
  delivered_at timestamptz,
  consumed_at timestamptz
);
create index if not exists desktop_auth_requests_expires_idx on public.desktop_auth_requests(expires_at);
alter table public.desktop_auth_requests enable row level security;
-- No client table access. All access goes through the service-role Lovable API.

create table if not exists public.agentcess_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  external_connection_id text,
  workspace_id text,
  status text not null default 'PENDING',
  peer text,
  metadata jsonb not null default '{}'::jsonb,
  last_ping_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists agentcess_connections_user_idx on public.agentcess_connections(user_id);
alter table public.agentcess_connections enable row level security;

create table if not exists public.production_agents (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  name text not null,
  agent_type text not null,
  purpose text not null,
  runtime text not null default 'GOOGLE_ADK',
  model text,
  status text not null default 'REGISTERING',
  owner_user_id uuid not null references auth.users(id),
  agentcess_agent_id text,
  agentcess_passport_version text,
  trust_status text,
  trust_score numeric,
  workspace_id text,
  capabilities jsonb not null default '[]'::jsonb,
  tools jsonb not null default '[]'::jsonb,
  data_classes jsonb not null default '[]'::jsonb,
  budget jsonb not null default '{}'::jsonb,
  registration_error text,
  last_agentcess_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists production_agents_prod_idx on public.production_agents(production_id);
alter table public.production_agents enable row level security;

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  agent_id uuid not null references public.production_agents(id) on delete cascade,
  external_run_id text,
  agentcess_run_id text,
  purpose text not null,
  status text not null default 'QUEUED',
  budget_limit numeric,
  spent numeric default 0,
  payload jsonb not null default '{}'::jsonb,
  started_at timestamptz default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists agent_runs_agent_idx on public.agent_runs(agent_id, created_at desc);
alter table public.agent_runs enable row level security;

create table if not exists public.agent_evidence (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  agent_id uuid not null references public.production_agents(id) on delete cascade,
  run_id uuid references public.agent_runs(id) on delete set null,
  event_type text not null,
  tool text,
  decision text,
  success boolean,
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists agent_evidence_agent_idx on public.agent_evidence(agent_id, created_at desc);
alter table public.agent_evidence enable row level security;
