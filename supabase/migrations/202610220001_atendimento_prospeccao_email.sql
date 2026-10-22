-- CRM enxuto + atendimento IA + prospecção + e-mail marketing (2026-10-22)
-- Idempotente. Não altera commercial_settings.ai_mode: quem liga a IA é um admin, pela tela Base da IA.

----------------------------------------------------------------------------
-- 1. Atendimento: configurações extras, base de conhecimento, rascunhos e retomadas
----------------------------------------------------------------------------
alter table public.commercial_settings
  add column if not exists meeting_link text,
  add column if not exists followup_enabled boolean not null default true,
  add column if not exists followup_after_minutes integer not null default 240,
  add column if not exists debounce_seconds integer not null default 8,
  add column if not exists voice_tone text;
alter table public.commercial_settings drop constraint if exists commercial_settings_followup_after_minutes_check;
alter table public.commercial_settings add constraint commercial_settings_followup_after_minutes_check check(followup_after_minutes between 30 and 1380);
alter table public.commercial_settings drop constraint if exists commercial_settings_debounce_seconds_check;
alter table public.commercial_settings add constraint commercial_settings_debounce_seconds_check check(debounce_seconds between 0 and 30);

create table if not exists public.ai_knowledge_entries(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_organization_id() references public.organizations(id) on delete cascade,
  category text not null check(category in('empresa','servicos','precos','cases','faq','regras','tom')),
  title text not null check(length(trim(title)) between 1 and 200),
  content text not null check(length(content) <= 6000),
  active boolean not null default true,
  sort_order integer not null default 0,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_knowledge_entries_org_idx on public.ai_knowledge_entries(organization_id,active,category,sort_order);

create table if not exists public.commercial_reply_drafts(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  event_id uuid unique references public.commercial_ai_events(id) on delete set null,
  draft_text text not null,
  status text not null default 'pending' check(status in('pending','sent','edited_sent','discarded','superseded')),
  final_text text,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists commercial_reply_drafts_pending_idx on public.commercial_reply_drafts(organization_id,conversation_id,created_at desc) where status='pending';

create table if not exists public.commercial_followups(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  anchor_message_id uuid not null references public.whatsapp_messages(id) on delete cascade,
  status text not null default 'sent' check(status in('sent','skipped','failed')),
  text_content text,
  error_message text,
  created_at timestamptz not null default now(),
  unique(conversation_id,anchor_message_id)
);

----------------------------------------------------------------------------
-- 2. Prospecção (LinkedIn assistido + e-mail frio pelo Gmail do domínio secundário)
----------------------------------------------------------------------------
create table if not exists public.outreach_settings(
  organization_id uuid primary key default public.current_organization_id() references public.organizations(id) on delete cascade,
  icp text,                                   -- perfil de cliente ideal
  offer text,                                 -- o que a Mugô oferece na abordagem
  sender_name text,
  sender_email text,                          -- caixa do domínio secundário (Gmail/Workspace)
  daily_email_limit integer not null default 30 check(daily_email_limit between 1 and 200),
  daily_linkedin_target integer not null default 20 check(daily_linkedin_target between 1 and 100),
  send_window_start time not null default '08:30',
  send_window_end time not null default '18:00',
  followup_days integer[] not null default array[3,7],
  email_template_html text,                   -- HTML leve com {{corpo}} e {{assinatura}}
  signature_html text,
  email_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.prospect_lists(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_organization_id() references public.organizations(id) on delete cascade,
  name text not null,
  segment text,
  source text not null default 'csv',
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.prospects(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_organization_id() references public.organizations(id) on delete cascade,
  list_id uuid references public.prospect_lists(id) on delete set null,
  company_name text not null,
  website text, instagram text, linkedin_company_url text, cnpj text,
  segment text, city text, state text,
  contact_name text, contact_role text, contact_linkedin_url text, contact_email text, contact_phone text,
  source text not null default 'manual' check(source in('manual','csv','apollo','cnpj','indicacao','outro')),
  status text not null default 'new' check(status in('new','ready','contacted','replied','meeting','converted','disqualified','do_not_contact')),
  research_status text not null default 'idle' check(research_status in('idle','queued','running','done','failed')),
  research_error text,
  research_attempts integer not null default 0,
  fit_score integer check(fit_score between 0 and 100),
  fit_reason text,
  research jsonb not null default '{}'::jsonb,
  hook text,
  linkedin_note text,
  linkedin_message text,
  email_subject text,
  email_body text,
  email_followups jsonb not null default '[]'::jsonb,
  linkedin_state text not null default 'pending' check(linkedin_state in('pending','connection_sent','connected','messaged','skipped')),
  email_state text not null default 'pending' check(email_state in('pending','approved','sequence','replied','bounced','stopped','skipped')),
  gmail_thread_id text,
  last_contact_at timestamptz,
  replied_at timestamptz,
  owner_id uuid references public.team_members(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  opportunity_id uuid references public.commercial_opportunities(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists prospects_org_email_uidx on public.prospects(organization_id,lower(contact_email)) where contact_email is not null and contact_email<>'';
create index if not exists prospects_pipeline_idx on public.prospects(organization_id,status,updated_at desc);
create index if not exists prospects_research_queue_idx on public.prospects(research_status,updated_at) where research_status='queued';

create table if not exists public.prospect_activities(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_organization_id() references public.organizations(id) on delete cascade,
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  channel text not null check(channel in('linkedin','email','whatsapp','phone','note','system')),
  activity_type text not null,
  content text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists prospect_activities_prospect_idx on public.prospect_activities(prospect_id,created_at desc);

create table if not exists public.outreach_email_queue(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  step integer not null check(step between 0 and 5),
  subject text not null,
  body_text text not null,
  scheduled_for timestamptz not null,
  status text not null default 'scheduled' check(status in('scheduled','sending','sent','failed','cancelled')),
  attempts integer not null default 0,
  gmail_message_id text,
  sent_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  unique(prospect_id,step)
);
create index if not exists outreach_email_queue_due_idx on public.outreach_email_queue(status,scheduled_for) where status in('scheduled','failed');

----------------------------------------------------------------------------
-- 3. E-mail marketing (Resend) — só para quem tem relação/consentimento
----------------------------------------------------------------------------
create table if not exists public.email_suppressions(
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check(email=lower(trim(email))),
  reason text not null check(reason in('unsubscribe','bounce','complaint','manual')),
  created_at timestamptz not null default now(),
  primary key(organization_id,email)
);

create table if not exists public.email_contacts(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_organization_id() references public.organizations(id) on delete cascade,
  email text not null,
  name text,
  client_id uuid references public.clients(id) on delete set null,
  prospect_id uuid references public.prospects(id) on delete set null,
  source text not null default 'manual' check(source in('manual','crm_client','crm_lead','prospect_replied','import','form')),
  tags text[] not null default '{}',
  subscribed boolean not null default true,
  unsubscribed_at timestamptz,
  unsubscribe_token uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.email_contacts drop constraint if exists email_contacts_email_lower_check;
alter table public.email_contacts add constraint email_contacts_email_lower_check check(email=lower(trim(email)));
alter table public.email_contacts drop constraint if exists email_contacts_org_email_key;
alter table public.email_contacts add constraint email_contacts_org_email_key unique(organization_id,email);

create table if not exists public.email_campaigns(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_organization_id() references public.organizations(id) on delete cascade,
  name text not null,
  subject text not null default '',
  preheader text,
  html text not null default '',
  from_name text,
  from_email text,
  reply_to text,
  audience jsonb not null default '{"tags":[],"sources":[]}'::jsonb,
  status text not null default 'draft' check(status in('draft','scheduled','sending','sent','failed')),
  scheduled_for timestamptz,
  sent_at timestamptz,
  stats jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.email_campaign_recipients(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null references public.email_campaigns(id) on delete cascade,
  contact_id uuid references public.email_contacts(id) on delete set null,
  email text not null,
  status text not null default 'queued' check(status in('queued','sent','delivered','opened','clicked','bounced','complained','failed','skipped')),
  resend_id text unique,
  opened_at timestamptz, clicked_at timestamptz, delivered_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_id,email)
);
create index if not exists email_campaign_recipients_queue_idx on public.email_campaign_recipients(campaign_id,status) where status='queued';

----------------------------------------------------------------------------
-- 4. RLS: leitura para usuários ativos da organização; escrita por papel
----------------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['ai_knowledge_entries','commercial_reply_drafts','commercial_followups','outreach_settings','prospect_lists','prospects','prospect_activities','outreach_email_queue','email_suppressions','email_contacts','email_campaigns','email_campaign_recipients'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select,insert,update,delete on public.%I to service_role',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('drop policy if exists %I on public.%I',t||'_read',t);
    execute format('create policy %I on public.%I for select to authenticated using(organization_id=public.current_organization_id() and public.is_active_user())',t||'_read',t);
  end loop;
end $$;

-- Base da IA e configurações: admin/manager
grant insert,update,delete on public.ai_knowledge_entries,public.outreach_settings to authenticated;
drop policy if exists ai_knowledge_entries_write on public.ai_knowledge_entries;
create policy ai_knowledge_entries_write on public.ai_knowledge_entries for all to authenticated
  using(organization_id=public.current_organization_id() and public.can_write())
  with check(organization_id=public.current_organization_id() and public.can_write());
drop policy if exists outreach_settings_write on public.outreach_settings;
create policy outreach_settings_write on public.outreach_settings for all to authenticated
  using(organization_id=public.current_organization_id() and public.can_write())
  with check(organization_id=public.current_organization_id() and public.can_write());
grant update on public.commercial_settings to authenticated;

-- Rascunhos da IA: quem atende pode aprovar/descartar
grant update on public.commercial_reply_drafts to authenticated;
drop policy if exists commercial_reply_drafts_decide on public.commercial_reply_drafts;
create policy commercial_reply_drafts_decide on public.commercial_reply_drafts for update to authenticated
  using(organization_id=public.current_organization_id() and public.can_operate())
  with check(organization_id=public.current_organization_id() and public.can_operate());

-- Prospecção: time comercial opera
grant insert,update,delete on public.prospect_lists,public.prospects,public.prospect_activities to authenticated;
grant insert,update on public.outreach_email_queue to authenticated;
do $$ declare t text; begin
  foreach t in array array['prospect_lists','prospects','prospect_activities','outreach_email_queue'] loop
    execute format('drop policy if exists %I on public.%I',t||'_write',t);
    execute format('create policy %I on public.%I for all to authenticated using(organization_id=public.current_organization_id() and public.can_operate()) with check(organization_id=public.current_organization_id() and public.can_operate())',t||'_write',t);
  end loop;
end $$;

-- E-mail marketing: admin/manager. Envio real só pela Edge Function (service_role).
grant insert,update,delete on public.email_contacts,public.email_campaigns,public.email_suppressions to authenticated;
do $$ declare t text; begin
  foreach t in array array['email_contacts','email_campaigns','email_suppressions'] loop
    execute format('drop policy if exists %I on public.%I',t||'_write',t);
    execute format('create policy %I on public.%I for all to authenticated using(organization_id=public.current_organization_id() and public.can_write()) with check(organization_id=public.current_organization_id() and public.can_write())',t||'_write',t);
  end loop;
end $$;

-- Campanha só sai de 'draft'/'scheduled' para 'sending' pela Edge Function.
create or replace function public.guard_email_campaign_status()
returns trigger language plpgsql set search_path='' as $$
begin
  if auth.role() = 'authenticated' and new.status in('sending','sent','failed') and new.status is distinct from old.status then
    raise exception 'O envio da campanha é feito pelo servidor.' using errcode='42501';
  end if;
  return new;
end $$;
drop trigger if exists guard_email_campaign_status on public.email_campaigns;
create trigger guard_email_campaign_status before update on public.email_campaigns for each row execute function public.guard_email_campaign_status();

do $$ declare t text; begin
  foreach t in array array['ai_knowledge_entries','outreach_settings','prospects','email_contacts','email_campaigns','email_campaign_recipients'] loop
    execute format('drop trigger if exists set_updated_at on public.%I',t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()',t);
  end loop;
end $$;

----------------------------------------------------------------------------
-- 5. Importar contatos do CRM para a base de e-mail (clientes e leads com e-mail)
----------------------------------------------------------------------------
create or replace function public.sync_email_contacts_from_crm()
returns integer language plpgsql security definer set search_path='' as $$
declare org uuid := public.current_organization_id(); inserted integer;
begin
  if not public.can_write() then raise exception 'Sem permissão.' using errcode='42501'; end if;
  insert into public.email_contacts(organization_id,email,name,client_id,source,tags)
  select org, lower(trim(c.email)), coalesce(c.contact_name,c.company_name), c.id,
         case when c.status in('active') then 'crm_client' else 'crm_lead' end,
         array[case c.status when 'active' then 'cliente' when 'former' then 'ex-cliente' when 'inactive' then 'ex-cliente' else 'lead' end]
  from public.clients c
  where c.organization_id=org and trim(c.email) ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and c.status<>'archived'
    and not exists(select 1 from public.email_suppressions s where s.organization_id=org and s.email=lower(trim(c.email)))
  on conflict (organization_id,email) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end $$;
revoke all on function public.sync_email_contacts_from_crm() from public,anon;
grant execute on function public.sync_email_contacts_from_crm() to authenticated;

comment on table public.prospects is 'Prospecção ativa. LinkedIn é sempre enviado manualmente por uma pessoa; e-mail frio sai da caixa do domínio secundário, nunca pelo Resend.';
comment on table public.email_contacts is 'Base de e-mail marketing (Resend): só contatos com relação prévia ou consentimento. Prospects entram aqui apenas depois de responder.';
