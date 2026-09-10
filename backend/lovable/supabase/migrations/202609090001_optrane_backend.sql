-- OPTRANE backend schema for Lovable Cloud / Supabase.
-- PostgreSQL is the transactional system of record. ClickHouse is the production-analysis read model.

create extension if not exists pgcrypto;

create type public.production_status as enum ('PREP','ACTIVE','WRAP','ARCHIVED');
create type public.member_role as enum ('OWNER','PRODUCER','VIEWER');
create type public.script_kind as enum ('BASELINE','REVISION');
create type public.processing_status as enum ('QUEUED','PROCESSING','READY','FAILED');
create type public.analysis_status as enum ('QUEUED','RUNNING','COMPLETE','FAILED');
create type public.event_status as enum ('STARTED','RUNNING','COMPLETE','FAILED');
create type public.severity_level as enum ('CRITICAL','HIGH','MEDIUM','LOW');
create type public.plan_status as enum ('PROPOSED','APPROVED','REJECTED','APPLIED');
create type public.approval_decision as enum ('APPROVE','REJECT');

create table public.productions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  status public.production_status not null default 'PREP',
  shoot_start date,
  shoot_end date,
  current_script_version integer not null default 0 check (current_script_version >= 0),
  readiness integer not null default 100 check (readiness between 0 and 100),
  planned_cost numeric(14,2) not null default 0,
  scenes_count integer not null default 0,
  crew_count integer not null default 0,
  cast_count integer not null default 0,
  locations_count integer not null default 0,
  shoot_day_label text not null default 'Not scheduled',
  demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.production_members (
  production_id uuid not null references public.productions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'VIEWER',
  created_at timestamptz not null default now(),
  primary key (production_id, user_id)
);

create table public.script_versions (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  version integer not null check (version > 0),
  kind public.script_kind not null,
  filename text not null,
  storage_path text not null,
  content_type text not null default 'application/pdf',
  size_bytes bigint not null default 0,
  content_hash text,
  processing_status public.processing_status not null default 'QUEUED',
  processing_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (production_id, version)
);

create table public.upload_tickets (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  script_version integer not null,
  kind public.script_kind not null,
  filename text not null,
  storage_path text not null,
  upload_token text not null,
  expires_at timestamptz not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.scenes (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  script_version integer not null,
  scene_number text not null,
  heading text not null default '',
  location text not null default '',
  interior_exterior text not null default 'UNKNOWN',
  day_night text not null default 'UNKNOWN',
  page_eighths integer not null default 0,
  description text not null default '',
  content_hash text not null,
  created_at timestamptz not null default now(),
  unique (production_id, script_version, scene_number)
);

create table public.scene_elements (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references public.scenes(id) on delete cascade,
  production_id uuid not null references public.productions(id) on delete cascade,
  script_version integer not null,
  scene_number text not null,
  element_type text not null,
  element_name text not null,
  quantity integer not null default 1,
  confidence text not null default 'EXPLICIT',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.production_dependencies (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  source_type text not null,
  source_id text not null,
  relation text not null,
  target_type text not null,
  target_id text not null,
  criticality text not null default 'MEDIUM',
  state text not null default 'CONFIRMED',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.cast_members (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  name text not null,
  character_name text,
  status text not null default 'CONFIRMED',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.crew_members (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  name text not null,
  role text not null,
  status text not null default 'CONFIRMED',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  name text not null,
  address text,
  availability_until time,
  status text not null default 'CONFIRMED',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.permits (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  permit_type text not null,
  reference text,
  state text not null default 'UNVERIFIED',
  valid_from date,
  valid_to date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.equipment (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  name text not null,
  category text not null,
  quantity integer not null default 1,
  allocated integer not null default 0,
  state text not null default 'AVAILABLE',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  name text not null,
  quantity integer not null default 1,
  allocated integer not null default 0,
  state text not null default 'AVAILABLE',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.schedule_items (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  shoot_day integer not null,
  scene_number text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'PLANNED',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (production_id, shoot_day, scene_number)
);

create table public.call_sheets (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  shoot_day integer not null,
  script_version integer not null,
  status text not null default 'DRAFT',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.budget_lines (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  category text not null,
  label text not null,
  planned numeric(14,2) not null default 0,
  actual numeric(14,2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.production_facts (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  fact_type text not null,
  entity_id text not null,
  state text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (production_id, fact_type, entity_id)
);

create table public.risks (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  category text not null,
  severity public.severity_level not null,
  status text not null default 'OPEN',
  title text not null,
  description text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  revision_version integer not null,
  status public.analysis_status not null default 'QUEUED',
  readiness_before integer not null default 100,
  readiness_after integer not null default 100,
  error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create table public.script_changes (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  production_id uuid not null references public.productions(id) on delete cascade,
  scene_number text not null,
  change_type text not null,
  category text not null,
  label text not null,
  old_value text,
  new_value text,
  ignored boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.analysis_events (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  production_id uuid not null references public.productions(id) on delete cascade,
  type text not null,
  actor text not null,
  message text not null,
  status public.event_status not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.impact_findings (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  production_id uuid not null references public.productions(id) on delete cascade,
  category text not null,
  severity public.severity_level not null,
  status text not null default 'UNRESOLVED',
  reason text not null,
  evidence text not null default '',
  evidence_refs jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table public.recovery_plans (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  production_id uuid not null references public.productions(id) on delete cascade,
  code text not null check (code in ('A','B','C')),
  title text not null,
  estimated_cost_delta numeric(14,2) not null default 0,
  schedule_delta_minutes integer not null default 0,
  risk text not null check (risk in ('LOW','MEDIUM','HIGH')),
  changes_count integer not null default 0,
  recommended boolean not null default false,
  actions jsonb not null default '[]'::jsonb,
  assumptions jsonb not null default '[]'::jsonb,
  unresolved jsonb not null default '[]'::jsonb,
  status public.plan_status not null default 'PROPOSED',
  created_at timestamptz not null default now(),
  unique (analysis_id, code)
);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  plan_id uuid not null references public.recovery_plans(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_label text not null,
  decision public.approval_decision not null,
  reason text,
  created_at timestamptz not null default now()
);

create table public.artifact_deltas (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  plan_id uuid not null references public.recovery_plans(id) on delete cascade,
  kind text not null,
  title text not null,
  lines jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  event_type text not null,
  actor text not null,
  summary text not null,
  source text not null default 'BACKEND',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_members_user on public.production_members(user_id, production_id);
create index idx_script_versions_prod on public.script_versions(production_id, version desc);
create index idx_scenes_prod_version on public.scenes(production_id, script_version, scene_number);
create index idx_elements_prod_version on public.scene_elements(production_id, script_version, scene_number);
create index idx_dependencies_source on public.production_dependencies(production_id, source_id);
create index idx_dependencies_target on public.production_dependencies(production_id, target_id);
create index idx_facts_prod on public.production_facts(production_id, fact_type, entity_id);
create index idx_analyses_prod on public.analyses(production_id, created_at desc);
create index idx_analysis_events on public.analysis_events(analysis_id, created_at, id);
create index idx_changes_analysis on public.script_changes(analysis_id, created_at);
create index idx_findings_analysis on public.impact_findings(analysis_id, created_at);
create index idx_plans_analysis on public.recovery_plans(analysis_id, code);
create unique index uq_plan_approve_once on public.approvals(plan_id) where decision = 'APPROVE';
create index idx_audit_prod on public.audit_events(production_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger productions_updated_at before update on public.productions
for each row execute function public.set_updated_at();

create or replace function public.is_production_member(p_production_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.production_members m
    where m.production_id = p_production_id and m.user_id = auth.uid()
  );
$$;

create or replace function public.can_manage_production(p_production_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.production_members m
    where m.production_id = p_production_id
      and m.user_id = auth.uid()
      and m.role in ('OWNER','PRODUCER')
  );
$$;

revoke all on function public.is_production_member(uuid) from public;
revoke all on function public.can_manage_production(uuid) from public;
grant execute on function public.is_production_member(uuid) to authenticated;
grant execute on function public.can_manage_production(uuid) to authenticated;

-- RLS: desktop users can read their productions. All protected writes go through Edge Functions using the service role.
alter table public.productions enable row level security;
alter table public.production_members enable row level security;
alter table public.script_versions enable row level security;
alter table public.upload_tickets enable row level security;
alter table public.scenes enable row level security;
alter table public.scene_elements enable row level security;
alter table public.production_dependencies enable row level security;
alter table public.cast_members enable row level security;
alter table public.crew_members enable row level security;
alter table public.locations enable row level security;
alter table public.permits enable row level security;
alter table public.equipment enable row level security;
alter table public.vehicles enable row level security;
alter table public.schedule_items enable row level security;
alter table public.call_sheets enable row level security;
alter table public.budget_lines enable row level security;
alter table public.production_facts enable row level security;
alter table public.risks enable row level security;
alter table public.analyses enable row level security;
alter table public.script_changes enable row level security;
alter table public.analysis_events enable row level security;
alter table public.impact_findings enable row level security;
alter table public.recovery_plans enable row level security;
alter table public.approvals enable row level security;
alter table public.artifact_deltas enable row level security;
alter table public.audit_events enable row level security;

create policy productions_read on public.productions for select to authenticated using (public.is_production_member(id));
create policy members_read on public.production_members for select to authenticated using (user_id = auth.uid() or public.is_production_member(production_id));
create policy script_versions_read on public.script_versions for select to authenticated using (public.is_production_member(production_id));
create policy scenes_read on public.scenes for select to authenticated using (public.is_production_member(production_id));
create policy elements_read on public.scene_elements for select to authenticated using (public.is_production_member(production_id));
create policy dependencies_read on public.production_dependencies for select to authenticated using (public.is_production_member(production_id));
create policy cast_read on public.cast_members for select to authenticated using (public.is_production_member(production_id));
create policy crew_read on public.crew_members for select to authenticated using (public.is_production_member(production_id));
create policy locations_read on public.locations for select to authenticated using (public.is_production_member(production_id));
create policy permits_read on public.permits for select to authenticated using (public.is_production_member(production_id));
create policy equipment_read on public.equipment for select to authenticated using (public.is_production_member(production_id));
create policy vehicles_read on public.vehicles for select to authenticated using (public.is_production_member(production_id));
create policy schedule_read on public.schedule_items for select to authenticated using (public.is_production_member(production_id));
create policy call_sheets_read on public.call_sheets for select to authenticated using (public.is_production_member(production_id));
create policy budget_read on public.budget_lines for select to authenticated using (public.is_production_member(production_id));
create policy facts_read on public.production_facts for select to authenticated using (public.is_production_member(production_id));
create policy risks_read on public.risks for select to authenticated using (public.is_production_member(production_id));
create policy analyses_read on public.analyses for select to authenticated using (public.is_production_member(production_id));
create policy changes_read on public.script_changes for select to authenticated using (public.is_production_member(production_id));
create policy analysis_events_read on public.analysis_events for select to authenticated using (public.is_production_member(production_id));
create policy findings_read on public.impact_findings for select to authenticated using (public.is_production_member(production_id));
create policy plans_read on public.recovery_plans for select to authenticated using (public.is_production_member(production_id));
create policy approvals_read on public.approvals for select to authenticated using (public.is_production_member(production_id));
create policy artifacts_read on public.artifact_deltas for select to authenticated using (public.is_production_member(production_id));
create policy audit_read on public.audit_events for select to authenticated using (public.is_production_member(production_id));

-- Private screenplay bucket. Edge Functions mint two-hour signed upload URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scripts', 'scripts', false, 52428800, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Users do not need direct storage policies because upload/download URLs are signed by the backend.
-- Realtime is used by the desktop client for the visible agent timeline.
do $$
begin
  alter publication supabase_realtime add table public.analysis_events;
exception when duplicate_object then null;
end $$;
