-- Central Operacional Mugô. Migration aditiva: preparar e aplicar manualmente.
-- CRM/Supabase permanece canônico; integrações são projeções assíncronas.

alter table public.crm_tasks add column if not exists source text not null default 'crm';
alter table public.crm_tasks add column if not exists source_ref text;
alter table public.crm_tasks add column if not exists due_time time;
alter table public.crm_tasks add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.crm_tasks drop constraint if exists crm_tasks_source_check;
alter table public.crm_tasks add constraint crm_tasks_source_check
  check (source in ('crm','whatsapp','automation','trello','notion')) not valid;
create index if not exists crm_tasks_short_id_idx
  on public.crm_tasks(organization_id, left(replace(id::text, '-', ''), 6));
create or replace function public.resolve_crm_task_short_id(p_organization_id uuid,p_short_id text)
returns table(id uuid,title text,status text,metadata jsonb)
language sql stable security definer set search_path='' as $$
  select t.id,t.title,t.status,t.metadata from public.crm_tasks t
  where t.organization_id=p_organization_id
    and replace(t.id::text,'-','') like lower(regexp_replace(p_short_id,'[^a-fA-F0-9]','','g')) || '%'
  limit 2
$$;
revoke all on function public.resolve_crm_task_short_id(uuid,text) from public,anon,authenticated;
grant execute on function public.resolve_crm_task_short_id(uuid,text) to service_role;

alter table public.whatsapp_messages add column if not exists sender_type text not null default 'customer';
alter table public.whatsapp_messages add column if not exists team_member_id uuid references public.team_members(id) on delete set null;
alter table public.whatsapp_messages drop constraint if exists whatsapp_messages_sender_type_check;
alter table public.whatsapp_messages add constraint whatsapp_messages_sender_type_check
  check (sender_type in ('customer','internal')) not valid;
alter table public.whatsapp_contacts add column if not exists contact_type text not null default 'customer';
alter table public.whatsapp_contacts add column if not exists team_member_id uuid references public.team_members(id) on delete set null;
alter table public.whatsapp_contacts drop constraint if exists whatsapp_contacts_contact_type_check;
alter table public.whatsapp_contacts add constraint whatsapp_contacts_contact_type_check
  check (contact_type in ('customer','internal')) not valid;

alter table public.whatsapp_conversations add column if not exists assigned_team_member_id uuid references public.team_members(id) on delete set null;
alter table public.whatsapp_conversations add column if not exists handoff_at timestamptz;
alter table public.whatsapp_conversations add column if not exists assigned_at timestamptz;
alter table public.whatsapp_conversations add column if not exists closed_at timestamptz;

create table if not exists public.task_command_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  connection_id uuid not null references public.whatsapp_connections(id) on delete restrict,
  provider_message_id text not null,
  conversation_id uuid references public.whatsapp_conversations(id) on delete set null,
  wa_id text not null,
  team_member_id uuid not null references public.team_members(id) on delete restrict,
  raw_text text not null,
  parsed_command jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  result jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint task_command_events_status_check check (status in ('pending','processing','completed','failed','dead_letter','confirmation_required')),
  constraint task_command_events_attempts_check check (attempts >= 0),
  unique (connection_id, provider_message_id)
);
create index if not exists task_command_events_due_idx
  on public.task_command_events(status, next_attempt_at, created_at)
  where status in ('pending','failed');

create table if not exists public.task_external_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  task_id uuid not null references public.crm_tasks(id) on delete cascade,
  provider text not null check (provider in ('trello','notion')),
  external_id text not null,
  external_url text,
  external_parent_id text,
  external_status text,
  last_synced_hash text,
  last_synced_at timestamptz,
  last_external_updated_at timestamptz,
  sync_status text not null default 'pending' check (sync_status in ('pending','synced','retry','error')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, provider),
  unique (organization_id, provider, external_id)
);

create table if not exists public.task_sync_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  task_id uuid not null references public.crm_tasks(id) on delete cascade,
  operation text not null default 'upsert' check (operation in ('upsert','delete')),
  provider text not null check (provider in ('trello','notion')),
  origin text not null default 'crm' check (origin in ('crm','whatsapp','automation','trello','notion')),
  status text not null default 'pending' check (status in ('pending','processing','completed','failed','dead_letter')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (organization_id, provider, idempotency_key)
);
create index if not exists task_sync_outbox_due_idx
  on public.task_sync_outbox(provider, status, next_attempt_at, created_at)
  where status in ('pending','failed');
create unique index if not exists task_sync_outbox_one_processing_idx
  on public.task_sync_outbox(organization_id,task_id,provider)
  where status = 'processing';

create table if not exists public.task_integration_settings (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('trello','notion')),
  enabled boolean not null default false,
  configuration jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, provider)
);

create table if not exists public.task_external_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  provider text not null check (provider in ('trello','notion')),
  external_event_id text not null,
  external_id text,
  payload_hash text not null,
  status text not null default 'processed' check (status in ('processed','ignored','failed')),
  error_message text,
  created_at timestamptz not null default now(),
  unique (organization_id,provider,external_event_id)
);

create or replace function public.enqueue_task_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
declare task_origin text := coalesce(new.metadata->>'origin', new.source, 'crm');
declare state_hash text := md5(jsonb_build_object('title',new.title,'status',new.status,'priority',new.priority,'due_date',new.due_date,'due_time',new.due_time,'assigned_to',new.assigned_to,'client_id',new.client_id,'notes',new.notes)::text);
declare target text;
begin
  foreach target in array array['trello','notion'] loop
    if target <> task_origin then
      insert into public.task_sync_outbox(organization_id,task_id,provider,origin,payload,idempotency_key)
      values(new.organization_id,new.id,target,task_origin,jsonb_build_object('state_hash',state_hash),new.id::text || ':' || target || ':' || state_hash)
      on conflict (organization_id,provider,idempotency_key) do nothing;
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists enqueue_task_sync on public.crm_tasks;
create trigger enqueue_task_sync after insert or update of title,status,priority,due_date,due_time,assigned_to,client_id,notes
  on public.crm_tasks for each row execute function public.enqueue_task_sync();

do $$ declare t text; begin
  foreach t in array array['task_command_events','task_external_links','task_sync_outbox','task_integration_settings','task_external_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (organization_id=public.current_organization_id() and public.is_active_user())', t || '_read', t);
  end loop;
end $$;

drop policy if exists task_integration_settings_admin on public.task_integration_settings;
create policy task_integration_settings_admin on public.task_integration_settings
  for all to authenticated
  using (organization_id=public.current_organization_id() and public.is_admin())
  with check (organization_id=public.current_organization_id() and public.is_admin());
grant insert, update, delete on public.task_integration_settings to authenticated;

create or replace function public.protect_mugo_operational_tenant()
returns trigger language plpgsql set search_path = '' as $$
declare related_org uuid;
begin
  if tg_table_name in ('task_external_links','task_sync_outbox') then
    select organization_id into related_org from public.crm_tasks where id=new.task_id;
    if related_org is distinct from new.organization_id then raise exception 'Task tenant mismatch' using errcode='23514'; end if;
  elsif tg_table_name='task_command_events' then
    select organization_id into related_org from public.whatsapp_connections where id=new.connection_id;
    if related_org is distinct from new.organization_id or not exists(select 1 from public.team_members where id=new.team_member_id and organization_id=new.organization_id) then raise exception 'Command tenant mismatch' using errcode='23514'; end if;
  elsif tg_table_name in ('whatsapp_messages','whatsapp_contacts') and new.team_member_id is not null then
    if not exists(select 1 from public.team_members where id=new.team_member_id and organization_id=new.organization_id) then raise exception 'Member tenant mismatch' using errcode='23514'; end if;
  elsif tg_table_name='whatsapp_conversations' and new.assigned_team_member_id is not null then
    if not exists(select 1 from public.team_members where id=new.assigned_team_member_id and organization_id=new.organization_id) then raise exception 'Assignee tenant mismatch' using errcode='23514'; end if;
  end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['task_external_links','task_sync_outbox','task_command_events','whatsapp_messages','whatsapp_contacts','whatsapp_conversations'] loop
    execute format('drop trigger if exists protect_mugo_operational_tenant on public.%I',t);
    execute format('create trigger protect_mugo_operational_tenant before insert or update on public.%I for each row execute function public.protect_mugo_operational_tenant()',t);
  end loop;
end $$;

do $$ declare t text; begin
  foreach t in array array['task_external_links','task_integration_settings'] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

comment on table public.task_command_events is 'Fila durável e idempotente para comandos de membros internos recebidos pelo WhatsApp.';
comment on table public.task_sync_outbox is 'Outbox canônica de projeção de crm_tasks para Trello e Notion.';
comment on column public.task_integration_settings.configuration is 'Somente IDs e mapeamentos não secretos; tokens permanecem em Edge Function secrets.';
