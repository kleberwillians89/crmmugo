-- CRMugo comercial. Aditiva, opt-in por organização e sem alterar propostas reais.

create table if not exists public.commercial_settings(
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  ai_mode text not null default 'disabled' check(ai_mode in('disabled','copilot','controlled_auto')),
  commercial_owner_id uuid references public.team_members(id) on delete set null,
  fallback_enabled boolean not null default true,
  prompt_override text,
  authorized_pricing jsonb not null default '{}'::jsonb,
  qualification_rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);

create table if not exists public.commercial_opportunities(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  conversation_id uuid references public.whatsapp_conversations(id) on delete set null,
  assigned_to uuid references public.team_members(id) on delete set null,
  stage text not null default 'new_lead' check(stage in('new_lead','in_service','qualifying','qualified','meeting','proposal','negotiation','won','lost')),
  name text not null,contact_role text,email text,source text not null default 'whatsapp_organic',campaign text,ad_name text,
  utm_source text,utm_medium text,utm_campaign text,utm_content text,
  service_interests text[] not null default '{}',main_problem text,budget numeric(14,2),timeline text,urgency text,
  estimated_value numeric(14,2),next_action text,next_action_at timestamptz,conversation_summary text,
  tags text[] not null default '{}',internal_notes text,qualification_reason text,lost_reason text,
  last_interaction_at timestamptz,entered_at timestamptz not null default now(),closed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index if not exists commercial_opportunity_open_conversation_uidx on public.commercial_opportunities(organization_id,conversation_id) where stage not in('won','lost') and conversation_id is not null;
create index if not exists commercial_opportunities_pipeline_idx on public.commercial_opportunities(organization_id,stage,updated_at desc);

create table if not exists public.commercial_qualifications(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete restrict,
  opportunity_id uuid not null unique references public.commercial_opportunities(id) on delete cascade,
  company_name text,contact_name text,service_interest text[] not null default '{}',current_situation text,main_problem text,
  objective text,urgency text,budget numeric(14,2),decision_maker boolean,timeline text,qualified boolean not null default false,
  needs_human boolean not null default false,next_action text,classification text not null default 'new' check(classification in('new','discovery','qualified','commercially_interesting','no_fit','existing_client','support')),
  reasons text[] not null default '{}',missing_fields text[] not null default '{}',created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);

create table if not exists public.conversation_summaries(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete restrict,
  conversation_id uuid not null unique references public.whatsapp_conversations(id) on delete cascade,
  opportunity_id uuid references public.commercial_opportunities(id) on delete set null,
  summary text not null,structured_data jsonb not null default '{}'::jsonb,message_count integer not null default 0,
  last_message_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);

create table if not exists public.commercial_ai_events(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete restrict,
  connection_id uuid not null references public.whatsapp_connections(id) on delete restrict,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  message_id uuid references public.whatsapp_messages(id) on delete set null,provider_message_id text not null,
  status text not null default 'pending' check(status in('pending','processing','completed','failed','dead_letter','skipped')),
  attempts integer not null default 0,next_attempt_at timestamptz not null default now(),decision jsonb not null default '{}'::jsonb,
  error_code text,error_message text,created_at timestamptz not null default now(),processed_at timestamptz,
  unique(connection_id,provider_message_id)
);
create index if not exists commercial_ai_events_due_idx on public.commercial_ai_events(status,next_attempt_at,created_at) where status in('pending','failed');

create table if not exists public.commercial_notification_outbox(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete restrict,
  opportunity_id uuid not null references public.commercial_opportunities(id) on delete cascade,
  conversation_id uuid references public.whatsapp_conversations(id) on delete set null,
  notification_type text not null default 'qualified_lead_handoff',payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check(status in('pending','processing','completed','failed','dead_letter')),
  destination_kind text not null default 'primary' check(destination_kind in('primary','fallback')),
  attempts integer not null default 0,next_attempt_at timestamptz not null default now(),provider_message_id text,last_error text,
  idempotency_key text not null,created_at timestamptz not null default now(),processed_at timestamptz,
  unique(organization_id,idempotency_key)
);
create index if not exists commercial_notification_due_idx on public.commercial_notification_outbox(status,next_attempt_at,created_at) where status in('pending','failed');

create table if not exists public.commercial_briefing_outbox(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete restrict,
  opportunity_id uuid not null references public.commercial_opportunities(id) on delete cascade,provider text not null default 'notion' check(provider='notion'),
  status text not null default 'pending' check(status in('pending','processing','completed','failed','dead_letter')),
  attempts integer not null default 0,next_attempt_at timestamptz not null default now(),external_id text,external_url text,last_error text,
  idempotency_key text not null,created_at timestamptz not null default now(),processed_at timestamptz,
  unique(organization_id,idempotency_key),unique(opportunity_id,provider)
);

alter table public.whatsapp_contacts add column if not exists source text;
alter table public.whatsapp_contacts add column if not exists campaign text;
alter table public.whatsapp_contacts add column if not exists ad_name text;
alter table public.whatsapp_contacts add column if not exists utm jsonb not null default '{}'::jsonb;
alter table public.whatsapp_conversations add column if not exists opportunity_id uuid references public.commercial_opportunities(id) on delete set null;
alter table public.crm_tasks add column if not exists opportunity_id uuid references public.commercial_opportunities(id) on delete set null;
alter table public.crm_tasks add column if not exists task_type text not null default 'general';
alter table public.crm_tasks drop constraint if exists crm_tasks_org_source_ref_unique;
alter table public.crm_tasks add constraint crm_tasks_org_source_ref_unique unique(organization_id,source_ref);
alter table public.crm_tasks drop constraint if exists crm_tasks_task_type_check;
alter table public.crm_tasks add constraint crm_tasks_task_type_check check(task_type in('general','commercial','follow_up','meeting','proposal','briefing')) not valid;
create index if not exists crm_tasks_opportunity_idx on public.crm_tasks(organization_id,opportunity_id,status,due_date);

do $$ declare t text; begin
  foreach t in array array['commercial_settings','commercial_opportunities','commercial_qualifications','conversation_summaries','commercial_ai_events','commercial_notification_outbox','commercial_briefing_outbox'] loop
    execute format('alter table public.%I enable row level security',t);execute format('alter table public.%I force row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant select,insert,update,delete on public.%I to service_role',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy %I on public.%I for select to authenticated using(organization_id=public.current_organization_id() and public.is_active_user())',t||'_read',t);
  end loop;
end $$;
grant insert,update,delete on public.commercial_opportunities,public.commercial_qualifications,public.commercial_settings to authenticated;
create policy commercial_opportunities_write on public.commercial_opportunities for all to authenticated using(organization_id=public.current_organization_id() and public.can_write()) with check(organization_id=public.current_organization_id() and public.can_write());
create policy commercial_qualifications_write on public.commercial_qualifications for all to authenticated using(organization_id=public.current_organization_id() and public.can_write()) with check(organization_id=public.current_organization_id() and public.can_write());
create policy commercial_settings_admin on public.commercial_settings for all to authenticated using(organization_id=public.current_organization_id() and public.is_admin()) with check(organization_id=public.current_organization_id() and public.is_admin());
do $$ declare t text; begin foreach t in array array['commercial_settings','commercial_opportunities','commercial_qualifications','conversation_summaries'] loop execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()',t);end loop;end $$;

create or replace function public.protect_commercial_tenant()
returns trigger language plpgsql set search_path='' as $$
declare related_org uuid;
begin
  if tg_table_name='commercial_opportunities' then
    select organization_id into related_org from public.clients where id=new.client_id;
    if related_org is distinct from new.organization_id then raise exception 'Commercial client tenant mismatch' using errcode='23514';end if;
    if new.conversation_id is not null and not exists(select 1 from public.whatsapp_conversations where id=new.conversation_id and organization_id=new.organization_id) then raise exception 'Commercial conversation tenant mismatch' using errcode='23514';end if;
    if new.assigned_to is not null and not exists(select 1 from public.team_members where id=new.assigned_to and organization_id=new.organization_id) then raise exception 'Commercial assignee tenant mismatch' using errcode='23514';end if;
  elsif tg_table_name='commercial_qualifications' then select organization_id into related_org from public.commercial_opportunities where id=new.opportunity_id;
  elsif tg_table_name='conversation_summaries' then select organization_id into related_org from public.whatsapp_conversations where id=new.conversation_id;
  elsif tg_table_name in('commercial_notification_outbox','commercial_briefing_outbox') then select organization_id into related_org from public.commercial_opportunities where id=new.opportunity_id;
  elsif tg_table_name='commercial_ai_events' then select organization_id into related_org from public.whatsapp_conversations where id=new.conversation_id;
  end if;
  if related_org is not null and related_org is distinct from new.organization_id then raise exception 'Commercial tenant mismatch' using errcode='23514';end if;return new;
end $$;
do $$ declare t text; begin foreach t in array array['commercial_opportunities','commercial_qualifications','conversation_summaries','commercial_ai_events','commercial_notification_outbox','commercial_briefing_outbox'] loop execute format('create trigger protect_commercial_tenant before insert or update on public.%I for each row execute function public.protect_commercial_tenant()',t);end loop;end $$;

-- Apenas tarefas explicitamente relevantes viram projeção externa, salvo opt-in sync_all.
create or replace function public.enqueue_task_sync()
returns trigger language plpgsql security definer set search_path='' as $$
declare task_origin text:=coalesce(new.metadata->>'origin',new.source,'crm');declare state_hash text:=md5(jsonb_build_object('title',new.title,'status',new.status,'priority',new.priority,'due_date',new.due_date,'due_time',new.due_time,'assigned_to',new.assigned_to,'client_id',new.client_id,'opportunity_id',new.opportunity_id,'notes',new.notes)::text);declare target text;declare allowed boolean;
begin
  foreach target in array array['trello','notion'] loop
    select enabled and (coalesce((configuration->>'sync_all')::boolean,false) or coalesce((new.metadata->>'sync_external')::boolean,false) or exists(select 1 from public.task_external_links l where l.task_id=new.id and l.provider=target)) into allowed from public.task_integration_settings where organization_id=new.organization_id and provider=target;
    if coalesce(allowed,false) and target<>task_origin then insert into public.task_sync_outbox(organization_id,task_id,provider,origin,payload,idempotency_key) values(new.organization_id,new.id,target,task_origin,jsonb_build_object('state_hash',state_hash),new.id::text||':'||target||':'||state_hash) on conflict(organization_id,provider,idempotency_key) do nothing;end if;
  end loop;return new;
end $$;

comment on table public.commercial_opportunities is 'Pipeline comercial anterior à proposta; proposals continua representando proposta real.';
comment on table public.commercial_settings is 'Configuração não secreta por tenant. Telefones e tokens permanecem em Edge Function secrets.';
