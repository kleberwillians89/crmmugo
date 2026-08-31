-- Ativa o subsistema de automações do WhatsApp para o CRM.
-- Complementa 202607280004_whatsapp_automation_ai_foundation.sql adicionando o contrato de
-- fluxo, RLS/grants para o papel authenticated e as RPCs de fila do executor.
-- PREPARAR APENAS: aplicar em local/staging sob revisão. Não aplicar remotamente sem gate.

-- 1. Tabelas base (idempotente; cobre o caso da foundation não ter sido aplicada) -----------
create table if not exists public.automation_flows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null,
  trigger_type text not null,
  status text not null default 'draft',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.automation_versions (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references public.automation_flows(id),
  version integer not null,
  definition jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (flow_id, version)
);
create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  flow_id uuid not null references public.automation_flows(id),
  version_id uuid references public.automation_versions(id),
  status text not null,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.automation_run_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.automation_runs(id),
  step_key text not null,
  action_type text not null,
  status text not null,
  sanitized_result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists public.automation_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  event_type text not null,
  subject_id text,
  sanitized_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists public.automation_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  run_id uuid references public.automation_runs(id),
  level text not null,
  code text,
  created_at timestamptz not null default now()
);
create table if not exists public.automation_dead_letters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  event_id uuid references public.automation_events(id),
  error_code text not null,
  attempts integer not null default 0,
  retry_after timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- 2. Colunas do contrato de fluxo -----------------------------------------------------------
alter table public.automation_flows
  add column if not exists description text,
  add column if not exists trigger_config jsonb not null default '{}'::jsonb,
  add column if not exists active_version_id uuid references public.automation_versions(id),
  add column if not exists last_run_at timestamptz,
  add column if not exists run_count integer not null default 0,
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists updated_by uuid references auth.users(id);

alter table public.automation_versions
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists note text;

update public.automation_versions v
  set organization_id = f.organization_id
  from public.automation_flows f
  where v.flow_id = f.id and v.organization_id is null;

alter table public.automation_runs
  add column if not exists trigger_type text,
  add column if not exists event_id uuid references public.automation_events(id),
  add column if not exists idempotency_key text,
  add column if not exists error_code text,
  add column if not exists error_message text,
  add column if not exists context jsonb not null default '{}'::jsonb,
  add column if not exists attempts integer not null default 0,
  add column if not exists updated_at timestamptz not null default now();

alter table public.automation_run_steps
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists run_index integer not null default 0,
  add column if not exists idempotency_key text,
  add column if not exists started_at timestamptz,
  add column if not exists finished_at timestamptz,
  add column if not exists error_code text,
  add column if not exists error_message text;

update public.automation_run_steps s
  set organization_id = r.organization_id
  from public.automation_runs r
  where s.run_id = r.id and s.organization_id is null;

alter table public.automation_events
  add column if not exists dedupe_key text,
  add column if not exists status text not null default 'pending',
  add column if not exists attempts integer not null default 0,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text,
  add column if not exists processed_at timestamptz,
  add column if not exists last_error_code text,
  add column if not exists last_error_at timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid references auth.users(id);

-- 3. Constraints de domínio ---------------------------------------------------------------
alter table public.automation_flows drop constraint if exists automation_flows_status_check;
alter table public.automation_flows add constraint automation_flows_status_check
  check (status in ('draft', 'active', 'paused', 'archived'));
alter table public.automation_flows drop constraint if exists automation_flows_trigger_check;
alter table public.automation_flows add constraint automation_flows_trigger_check
  check (trigger_type in (
    'manual_event', 'crm_event', 'lead_created', 'invoice_overdue',
    'client_inactive', 'whatsapp_message_received'
  ));
alter table public.automation_flows drop constraint if exists automation_flows_name_check;
alter table public.automation_flows add constraint automation_flows_name_check
  check (length(trim(name)) between 1 and 120);

alter table public.automation_runs drop constraint if exists automation_runs_status_check;
alter table public.automation_runs add constraint automation_runs_status_check
  check (status in ('pending', 'running', 'succeeded', 'failed', 'skipped', 'dead_letter', 'waiting'));

alter table public.automation_run_steps drop constraint if exists automation_run_steps_status_check;
alter table public.automation_run_steps add constraint automation_run_steps_status_check
  check (status in ('pending', 'running', 'succeeded', 'failed', 'skipped'));

alter table public.automation_events drop constraint if exists automation_events_status_check;
alter table public.automation_events add constraint automation_events_status_check
  check (status in ('pending', 'processing', 'processed', 'failed', 'skipped', 'dead_letter'));

-- 4. Índices ---------------------------------------------------------------------------
create index if not exists automation_flows_org_status_idx
  on public.automation_flows(organization_id, status, updated_at desc);
create index if not exists automation_versions_flow_idx
  on public.automation_versions(flow_id, version desc);
create unique index if not exists automation_runs_idempotency_uidx
  on public.automation_runs(flow_id, idempotency_key) where idempotency_key is not null;
create index if not exists automation_runs_flow_idx
  on public.automation_runs(organization_id, flow_id, created_at desc);
create index if not exists automation_run_steps_run_idx
  on public.automation_run_steps(run_id, run_index);
create unique index if not exists automation_events_dedupe_uidx
  on public.automation_events(organization_id, dedupe_key) where dedupe_key is not null;
create index if not exists automation_events_pending_idx
  on public.automation_events(status, next_attempt_at, created_at) where status in ('pending', 'failed');

-- 5. updated_at ----------------------------------------------------------------------
drop trigger if exists set_updated_at on public.automation_flows;
create trigger set_updated_at before update on public.automation_flows
  for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.automation_runs;
create trigger set_updated_at before update on public.automation_runs
  for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.automation_events;
create trigger set_updated_at before update on public.automation_events
  for each row execute function public.set_updated_at();

-- 6. RLS + grants ------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'automation_flows', 'automation_versions', 'automation_runs', 'automation_run_steps',
    'automation_events', 'automation_logs', 'automation_dead_letters'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

grant insert, update on public.automation_flows to authenticated;
grant insert on public.automation_versions to authenticated;

drop policy if exists automation_flows_read on public.automation_flows;
create policy automation_flows_read on public.automation_flows for select to authenticated
  using (organization_id = public.current_organization_id() and public.is_active_user());
drop policy if exists automation_flows_insert on public.automation_flows;
create policy automation_flows_insert on public.automation_flows for insert to authenticated
  with check (organization_id = public.current_organization_id() and public.can_write());
drop policy if exists automation_flows_update on public.automation_flows;
create policy automation_flows_update on public.automation_flows for update to authenticated
  using (organization_id = public.current_organization_id() and public.can_write())
  with check (organization_id = public.current_organization_id() and public.can_write());

drop policy if exists automation_versions_read on public.automation_versions;
create policy automation_versions_read on public.automation_versions for select to authenticated
  using (organization_id = public.current_organization_id() and public.is_active_user());
drop policy if exists automation_versions_insert on public.automation_versions;
create policy automation_versions_insert on public.automation_versions for insert to authenticated
  with check (
    organization_id = public.current_organization_id() and public.can_write()
    and exists (
      select 1 from public.automation_flows f
      where f.id = flow_id and f.organization_id = public.current_organization_id()
    )
  );

drop policy if exists automation_runs_read on public.automation_runs;
create policy automation_runs_read on public.automation_runs for select to authenticated
  using (organization_id = public.current_organization_id() and public.is_active_user());
drop policy if exists automation_run_steps_read on public.automation_run_steps;
create policy automation_run_steps_read on public.automation_run_steps for select to authenticated
  using (organization_id = public.current_organization_id() and public.is_active_user());
drop policy if exists automation_events_read on public.automation_events;
create policy automation_events_read on public.automation_events for select to authenticated
  using (organization_id = public.current_organization_id() and public.is_active_user());
drop policy if exists automation_logs_read on public.automation_logs;
create policy automation_logs_read on public.automation_logs for select to authenticated
  using (organization_id = public.current_organization_id() and public.is_active_user());
drop policy if exists automation_dead_letters_read on public.automation_dead_letters;
create policy automation_dead_letters_read on public.automation_dead_letters for select to authenticated
  using (organization_id = public.current_organization_id() and public.is_active_user());

-- 7. RPC: o CRM autenticado enfileira eventos (gatilho manual e eventos de CRM) -----------
create or replace function public.enqueue_automation_event(
  p_event_type text,
  p_subject_id text default null,
  p_payload jsonb default '{}'::jsonb,
  p_dedupe_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.current_organization_id();
  v_event_id uuid;
begin
  if v_org is null or not public.can_write() then
    raise exception 'not authorized to enqueue automation events' using errcode = '42501';
  end if;
  if p_event_type is null or length(trim(p_event_type)) = 0 then
    raise exception 'event_type is required' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'payload must be a json object' using errcode = '22023';
  end if;
  if coalesce(p_payload, '{}'::jsonb) ?| array[
    'token', 'access_token', 'secret', 'password', 'authorization', 'api_key', 'apikey', 'service_role'
  ] then
    raise exception 'payload must not contain secret keys' using errcode = '22023';
  end if;

  insert into public.automation_events(
    organization_id, event_type, subject_id, sanitized_payload, dedupe_key, status, created_by
  )
  values (
    v_org,
    left(trim(p_event_type), 80),
    nullif(left(coalesce(p_subject_id, ''), 120), ''),
    coalesce(p_payload, '{}'::jsonb),
    nullif(left(coalesce(p_dedupe_key, ''), 200), ''),
    'pending',
    auth.uid()
  )
  on conflict (organization_id, dedupe_key) where dedupe_key is not null
  do update set sanitized_payload = public.automation_events.sanitized_payload
  returning id into v_event_id;

  return v_event_id;
end
$$;

revoke all on function public.enqueue_automation_event(text, text, jsonb, text) from public, anon;
grant execute on function public.enqueue_automation_event(text, text, jsonb, text) to authenticated;

-- 8. RPC: o executor (service_role) reivindica eventos pendentes com lock -----------------
create or replace function public.claim_automation_events(
  p_worker_id text,
  p_limit integer default 20,
  p_max_attempts integer default 6
)
returns setof public.automation_events
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_worker_id is null or trim(p_worker_id) = '' then
    raise exception 'worker_id is required' using errcode = '22023';
  end if;
  return query
  with candidates as (
    select e.id
    from public.automation_events e
    where e.status in ('pending', 'failed')
      and coalesce(e.next_attempt_at, now()) <= now()
      and e.attempts < greatest(p_max_attempts, 1)
    order by e.created_at
    for update skip locked
    limit least(greatest(p_limit, 1), 100)
  )
  update public.automation_events e
  set status = 'processing',
      locked_at = now(),
      locked_by = left(p_worker_id, 120),
      attempts = e.attempts + 1,
      updated_at = now()
  from candidates
  where e.id = candidates.id
  returning e.*;
end
$$;

revoke all on function public.claim_automation_events(text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_automation_events(text, integer, integer) to service_role;

comment on table public.automation_events is
  'Fila de eventos de automação. Leitura para authenticated; escrita via enqueue_automation_event / service_role.';
comment on table public.automation_runs is
  'Execuções de automação. Somente leitura para authenticated; idempotência por (flow_id, idempotency_key).';
