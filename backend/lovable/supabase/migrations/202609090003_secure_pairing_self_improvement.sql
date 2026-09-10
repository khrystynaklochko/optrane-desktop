-- OPTRANE v0.5: secure website->desktop pairing metadata, private governance peer state,
-- and bounded self-improvement candidates. These tables are service-role managed.

alter table public.desktop_auth_requests
  add column if not exists device_name text,
  add column if not exists platform text,
  add column if not exists app_version text,
  add column if not exists exchange_attempts integer not null default 0,
  add column if not exists last_exchange_at timestamptz;

-- Internal peer connection state. No desktop/browser RLS policies are granted.
create table if not exists public.governance_peer_connections (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'Agentcess',
  external_connection_id text,
  workspace_id text,
  status text not null default 'DISCONNECTED',
  public_key text,
  challenge text,
  challenge_expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  last_verified_at timestamptz,
  last_ping_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.governance_peer_connections enable row level security;

alter table public.production_agents
  add column if not exists self_improvement_policy jsonb not null default '{}'::jsonb,
  add column if not exists self_improvement_budget jsonb not null default '{}'::jsonb,
  add column if not exists strategy_config jsonb not null default '{}'::jsonb,
  add column if not exists active_config_version integer not null default 1;

create table if not exists public.agent_improvement_candidates (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  agent_id uuid not null references public.production_agents(id) on delete cascade,
  run_id uuid references public.agent_runs(id) on delete set null,
  config_version_from integer not null default 1,
  type text not null,
  current_value text,
  proposed_value text not null,
  rationale text,
  evidence jsonb not null default '{}'::jsonb,
  estimated_cost numeric not null default 0,
  actual_cost numeric,
  status text not null default 'PROPOSED' check (status in ('PROPOSED','EVALUATING','APPROVED','REJECTED','PROMOTED')),
  created_at timestamptz not null default now(),
  approved_by uuid references auth.users(id),
  approved_at timestamptz
);
create index if not exists agent_improvement_candidates_agent_idx
  on public.agent_improvement_candidates(agent_id, created_at desc);
alter table public.agent_improvement_candidates enable row level security;

create table if not exists public.agent_config_versions (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  agent_id uuid not null references public.production_agents(id) on delete cascade,
  version integer not null,
  strategy_config jsonb not null default '{}'::jsonb,
  source_candidate_id uuid references public.agent_improvement_candidates(id) on delete set null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique(agent_id, version)
);
alter table public.agent_config_versions enable row level security;

create table if not exists public.agent_budget_ledger (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  agent_id uuid not null references public.production_agents(id) on delete cascade,
  run_id uuid references public.agent_runs(id) on delete set null,
  category text not null check (category in ('EXECUTION','SELF_IMPROVEMENT')),
  amount numeric not null check (amount >= 0),
  currency text not null default 'USD',
  units integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists agent_budget_ledger_agent_day_idx
  on public.agent_budget_ledger(agent_id, created_at desc);
alter table public.agent_budget_ledger enable row level security;

create table if not exists public.governance_webhook_receipts (
  event_id text primary key,
  provider text not null default 'Agentcess',
  received_at timestamptz not null default now()
);
alter table public.governance_webhook_receipts enable row level security;
