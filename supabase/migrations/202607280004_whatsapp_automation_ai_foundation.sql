-- PREPARATION ONLY. Do not apply before a separate RLS and rollout review.

create table if not exists public.automation_flows (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  name text not null, trigger_type text not null, status text not null default 'draft',
  archived_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.automation_versions (
  id uuid primary key default gen_random_uuid(), flow_id uuid not null references public.automation_flows(id),
  version integer not null, definition jsonb not null default '{}', created_at timestamptz not null default now(),
  unique(flow_id,version)
);
create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  flow_id uuid not null references public.automation_flows(id), version_id uuid references public.automation_versions(id),
  status text not null, started_at timestamptz, finished_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.automation_run_steps (
  id uuid primary key default gen_random_uuid(), run_id uuid not null references public.automation_runs(id),
  step_key text not null, action_type text not null, status text not null, sanitized_result jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table if not exists public.automation_events (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  event_type text not null, subject_id text, sanitized_payload jsonb not null default '{}', created_at timestamptz not null default now()
);
create table if not exists public.automation_logs (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  run_id uuid references public.automation_runs(id), level text not null, code text, created_at timestamptz not null default now()
);
create table if not exists public.automation_dead_letters (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  event_id uuid references public.automation_events(id), error_code text not null, attempts integer not null default 0,
  retry_after timestamptz, resolved_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.ai_settings (
  organization_id uuid primary key references public.organizations(id), mode text not null default 'disabled',
  confidence_threshold numeric not null default 0.8, prohibited_topics text[] not null default array['legal','sensitive_billing'],
  updated_at timestamptz not null default now()
);
create table if not exists public.ai_knowledge_sources (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  title text not null, source_type text not null, status text not null default 'draft', created_at timestamptz not null default now()
);
create table if not exists public.ai_conversation_runs (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  conversation_id text not null, mode text not null, model text, duration_ms integer, cost numeric, confidence numeric,
  status text not null, created_at timestamptz not null default now()
);
create table if not exists public.ai_suggestions (
  id uuid primary key default gen_random_uuid(), run_id uuid not null references public.ai_conversation_runs(id),
  status text not null default 'pending', sanitized_preview text, approved_by uuid, created_at timestamptz not null default now()
);
create table if not exists public.ai_handoffs (
  id uuid primary key default gen_random_uuid(), run_id uuid not null references public.ai_conversation_runs(id),
  reason_code text not null, assigned_to uuid, created_at timestamptz not null default now()
);
create table if not exists public.ai_usage_logs (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  run_id uuid references public.ai_conversation_runs(id), model text, duration_ms integer, cost numeric, confidence numeric,
  created_at timestamptz not null default now()
);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'automation_flows','automation_versions','automation_runs','automation_run_steps','automation_events',
    'automation_logs','automation_dead_letters','ai_settings','ai_knowledge_sources','ai_conversation_runs',
    'ai_suggestions','ai_handoffs','ai_usage_logs'
  ] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('alter table public.%I force row level security',table_name);
    execute format('revoke all on public.%I from public, anon, authenticated',table_name);
    execute format('grant select, insert, update on public.%I to service_role',table_name);
  end loop;
end
$$;
