-- Propostas e documentos comerciais recebidos pelo WhatsApp.
-- Evolução aditiva: reutiliza proposals, proposal_services e documents.

alter table public.proposals add column if not exists opportunity_id uuid references public.commercial_opportunities(id) on delete set null;
alter table public.proposals add column if not exists conversation_id uuid references public.whatsapp_conversations(id) on delete set null;
alter table public.proposals add column if not exists currency text not null default 'BRL';
alter table public.proposals add column if not exists proposal_date date;
alter table public.proposals add column if not exists source text not null default 'crm';
alter table public.proposals add column if not exists source_ref text;
alter table public.proposals drop constraint if exists proposals_status_check;
alter table public.proposals add constraint proposals_status_check check(status in('draft','sent','viewed','negotiating','accepted','rejected','won','lost','expired','cancelled')) not valid;
alter table public.proposals add constraint proposals_currency_check check(currency ~ '^[A-Z]{3}$') not valid;
create unique index if not exists proposals_source_ref_uidx on public.proposals(organization_id,source,source_ref) where source_ref is not null;
create index if not exists proposals_opportunity_idx on public.proposals(organization_id,opportunity_id,updated_at desc);
create index if not exists proposals_conversation_idx on public.proposals(organization_id,conversation_id,updated_at desc);

alter table public.documents add column if not exists opportunity_id uuid references public.commercial_opportunities(id) on delete set null;
alter table public.documents add column if not exists conversation_id uuid references public.whatsapp_conversations(id) on delete set null;
alter table public.documents add column if not exists task_id uuid references public.crm_tasks(id) on delete set null;
alter table public.documents add column if not exists original_filename text;
alter table public.documents add column if not exists content_sha256 text;
alter table public.documents add column if not exists source text not null default 'crm';
alter table public.documents add column if not exists source_ref text;
alter table public.documents add column if not exists created_at timestamptz not null default now();
update public.documents set original_filename=coalesce(original_filename,file_name),created_at=coalesce(uploaded_at,created_at) where original_filename is null;
create unique index if not exists documents_source_ref_uidx on public.documents(organization_id,source,source_ref) where source_ref is not null;
create unique index if not exists documents_content_sha256_uidx on public.documents(organization_id,content_sha256) where content_sha256 is not null;
create index if not exists documents_opportunity_idx on public.documents(organization_id,opportunity_id,created_at desc);
create index if not exists documents_task_idx on public.documents(organization_id,task_id,created_at desc);

alter table public.task_command_events add column if not exists message_id uuid references public.whatsapp_messages(id) on delete set null;
alter table public.task_command_events add column if not exists message_type text not null default 'text';
alter table public.task_command_events add column if not exists media jsonb not null default '{}'::jsonb;

create table if not exists public.commercial_command_confirmations(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  command_event_id uuid not null references public.task_command_events(id) on delete restrict,
  team_member_id uuid not null references public.team_members(id) on delete restrict,
  action_type text not null check(action_type in('proposal_create','proposal_update','proposal_attachment')),
  client_id uuid references public.clients(id) on delete set null,
  opportunity_id uuid references public.commercial_opportunities(id) on delete set null,
  proposal_id uuid references public.proposals(id) on delete set null,
  conversation_id uuid references public.whatsapp_conversations(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check(status in('pending','awaiting_context','confirmed','cancelled','expired')),
  expires_at timestamptz not null default now()+interval '30 minutes',
  confirmed_at timestamptz,
  resolution_command_event_id uuid references public.task_command_events(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(command_event_id)
);
create unique index if not exists commercial_command_resolution_uidx on public.commercial_command_confirmations(resolution_command_event_id) where resolution_command_event_id is not null;
create unique index if not exists commercial_command_one_pending_idx on public.commercial_command_confirmations(organization_id,team_member_id) where status in('pending','awaiting_context');
alter table public.commercial_command_confirmations enable row level security;
alter table public.commercial_command_confirmations force row level security;
revoke all on public.commercial_command_confirmations from public,anon,authenticated;
grant select,insert,update,delete on public.commercial_command_confirmations to service_role;
grant select on public.commercial_command_confirmations to authenticated;
create policy commercial_command_confirmations_read on public.commercial_command_confirmations for select to authenticated
  using(organization_id=public.current_organization_id() and public.current_user_role() in('admin','manager','commercial'));

create or replace function public.protect_commercial_command_tenant() returns trigger language plpgsql set search_path='' as $$
begin
  if not exists(select 1 from public.task_command_events where id=new.command_event_id and organization_id=new.organization_id)
    or not exists(select 1 from public.team_members where id=new.team_member_id and organization_id=new.organization_id)
    or (new.client_id is not null and not exists(select 1 from public.clients where id=new.client_id and organization_id=new.organization_id))
    or (new.opportunity_id is not null and not exists(select 1 from public.commercial_opportunities where id=new.opportunity_id and organization_id=new.organization_id))
    or (new.proposal_id is not null and not exists(select 1 from public.proposals where id=new.proposal_id and organization_id=new.organization_id))
    or (new.conversation_id is not null and not exists(select 1 from public.whatsapp_conversations where id=new.conversation_id and organization_id=new.organization_id))
  then raise exception 'Commercial confirmation tenant mismatch' using errcode='23514';end if;
  return new;
end$$;
drop trigger if exists protect_commercial_command_tenant on public.commercial_command_confirmations;
create trigger protect_commercial_command_tenant before insert or update on public.commercial_command_confirmations for each row execute function public.protect_commercial_command_tenant();

create or replace function public.protect_proposal_document_tenant() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_table_name='proposals' then
    if not exists(select 1 from public.clients where id=new.client_id and organization_id=new.organization_id)
      or (new.responsible_id is not null and not exists(select 1 from public.team_members where id=new.responsible_id and organization_id=new.organization_id))
      or (new.opportunity_id is not null and not exists(select 1 from public.commercial_opportunities where id=new.opportunity_id and organization_id=new.organization_id))
      or (new.conversation_id is not null and not exists(select 1 from public.whatsapp_conversations where id=new.conversation_id and organization_id=new.organization_id))
    then raise exception 'Proposal tenant mismatch' using errcode='23514';end if;
  elsif tg_table_name='documents' then
    if not exists(select 1 from public.clients where id=new.client_id and organization_id=new.organization_id)
      or (new.proposal_id is not null and not exists(select 1 from public.proposals where id=new.proposal_id and organization_id=new.organization_id))
      or (new.contract_id is not null and not exists(select 1 from public.contracts where id=new.contract_id and organization_id=new.organization_id))
      or (new.task_id is not null and not exists(select 1 from public.crm_tasks where id=new.task_id and organization_id=new.organization_id))
      or (new.opportunity_id is not null and not exists(select 1 from public.commercial_opportunities where id=new.opportunity_id and organization_id=new.organization_id))
      or (new.conversation_id is not null and not exists(select 1 from public.whatsapp_conversations where id=new.conversation_id and organization_id=new.organization_id))
      or (new.uploaded_by is not null and not exists(select 1 from public.profiles where id=new.uploaded_by and organization_id=new.organization_id))
    then raise exception 'Document tenant mismatch' using errcode='23514';end if;
  end if;
  return new;
end$$;
drop trigger if exists protect_proposal_document_tenant on public.proposals;
create trigger protect_proposal_document_tenant before insert or update on public.proposals for each row execute function public.protect_proposal_document_tenant();
drop trigger if exists protect_proposal_document_tenant on public.documents;
create trigger protect_proposal_document_tenant before insert or update on public.documents for each row execute function public.protect_proposal_document_tenant();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('crm-documents','crm-documents',false,10485760,array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

alter table public.crm_tasks add column if not exists starts_at timestamptz;
alter table public.crm_tasks add column if not exists ends_at timestamptz;
alter table public.crm_tasks add column if not exists category text;
alter table public.crm_tasks add column if not exists participants text[] not null default '{}';
alter table public.crm_tasks add column if not exists planned_hours numeric(7,2);
alter table public.crm_tasks add column if not exists worked_hours numeric(7,2);
alter table public.crm_tasks add column if not exists complement_hours numeric(7,2);
alter table public.crm_tasks add column if not exists fixed boolean not null default false;
alter table public.crm_tasks add column if not exists recurrence_rule jsonb not null default '{}'::jsonb;
alter table public.crm_tasks add constraint crm_tasks_time_range_check check(ends_at is null or starts_at is null or ends_at>=starts_at) not valid;
alter table public.crm_tasks add constraint crm_tasks_hours_check check(coalesce(planned_hours,0)>=0 and coalesce(worked_hours,0)>=0 and coalesce(complement_hours,0)>=0) not valid;

alter table public.financial_debts add column if not exists source text not null default 'crm';
alter table public.financial_debts add column if not exists source_ref text;
create unique index if not exists financial_debts_source_ref_uidx on public.financial_debts(organization_id,source,source_ref) where source_ref is not null;
alter table public.financial_goals add column if not exists source text not null default 'crm';
alter table public.financial_goals add column if not exists source_ref text;
create unique index if not exists financial_goals_source_ref_uidx on public.financial_goals(organization_id,source,source_ref) where source_ref is not null;

comment on table public.commercial_command_confirmations is 'Confirmações idempotentes de propostas e anexos recebidos em comandos internos.';
comment on column public.documents.content_sha256 is 'SHA-256 calculado server-side; evita armazenar novamente o mesmo arquivo no tenant.';
