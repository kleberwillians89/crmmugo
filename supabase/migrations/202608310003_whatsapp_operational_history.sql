-- Camada operacional canônica do WhatsApp no CRM.
-- Aditiva: o MugoZap continua sendo o adaptador de envio; o CRM passa a preservar
-- contatos, conversas, mensagens/status, handoffs e follow-ups por organização/conexão.

create table if not exists public.whatsapp_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  connection_id uuid not null references public.whatsapp_connections(id) on delete restrict,
  client_id uuid references public.clients(id) on delete set null,
  wa_id text not null,
  display_name text,
  profile_name text,
  metadata jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_contacts_wa_id_check check (wa_id ~ '^[0-9]{8,15}$'),
  constraint whatsapp_contacts_metadata_object check (jsonb_typeof(metadata) = 'object'),
  unique (connection_id, wa_id)
);

create table if not exists public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  connection_id uuid not null references public.whatsapp_connections(id) on delete restrict,
  contact_id uuid not null references public.whatsapp_contacts(id) on delete restrict,
  wa_id text not null,
  status text not null default 'open',
  attendance_mode text not null default 'bot',
  automation_paused boolean not null default false,
  unread_count integer not null default 0 check (unread_count >= 0),
  assigned_to uuid references auth.users(id) on delete set null,
  handoff_reason text,
  service_window_expires_at timestamptz,
  follow_up_at timestamptz,
  last_message_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_conversations_status_check check (status in ('open','pending','resolved','closed')),
  constraint whatsapp_conversations_attendance_check check (attendance_mode in ('bot','human','paused')),
  unique (connection_id, wa_id)
);

create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  connection_id uuid not null references public.whatsapp_connections(id) on delete restrict,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete restrict,
  provider_message_id text,
  idempotency_key text,
  direction text not null,
  message_type text not null default 'text',
  status text not null default 'accepted',
  text_content text,
  media jsonb not null default '{}'::jsonb,
  template_name text,
  template_language text,
  template_components jsonb not null default '[]'::jsonb,
  error_code text,
  error_message text,
  pricing jsonb not null default '{}'::jsonb,
  provider_timestamp timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_messages_direction_check check (direction in ('in','out')),
  constraint whatsapp_messages_status_check check (status in ('received','queued','accepted','sent','delivered','read','failed')),
  constraint whatsapp_messages_media_object check (jsonb_typeof(media) = 'object'),
  constraint whatsapp_messages_components_array check (jsonb_typeof(template_components) = 'array'),
  constraint whatsapp_messages_pricing_object check (jsonb_typeof(pricing) = 'object'),
  constraint whatsapp_messages_provider_uidx unique (connection_id, provider_message_id),
  constraint whatsapp_messages_idempotency_uidx unique (connection_id, idempotency_key)
);
create index if not exists whatsapp_messages_history_idx
  on public.whatsapp_messages(conversation_id, created_at desc);
create index if not exists whatsapp_conversations_inbox_idx
  on public.whatsapp_conversations(organization_id, status, last_message_at desc);
create index if not exists whatsapp_contacts_org_idx
  on public.whatsapp_contacts(organization_id, last_seen_at desc);

create table if not exists public.whatsapp_webhook_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  connection_id uuid not null references public.whatsapp_connections(id) on delete restrict,
  event_key text not null,
  event_type text not null,
  payload_hash text not null,
  processed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (connection_id, event_key)
);

create table if not exists public.whatsapp_conversation_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  connection_id uuid not null references public.whatsapp_connections(id) on delete restrict,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete restrict,
  event_type text not null,
  actor_id uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint whatsapp_conversation_events_details_object check (jsonb_typeof(details) = 'object')
);

create table if not exists public.whatsapp_follow_ups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  connection_id uuid not null references public.whatsapp_connections(id) on delete restrict,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete restrict,
  automation_run_id uuid references public.automation_runs(id) on delete set null,
  run_at timestamptz not null,
  timezone text not null default 'America/Sao_Paulo',
  action jsonb not null,
  status text not null default 'scheduled',
  attempts integer not null default 0,
  locked_at timestamptz,
  locked_by text,
  last_error_code text,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_follow_ups_status_check check (status in ('scheduled','processing','completed','failed','cancelled')),
  constraint whatsapp_follow_ups_action_object check (jsonb_typeof(action) = 'object')
);
create index if not exists whatsapp_follow_ups_due_idx
  on public.whatsapp_follow_ups(status, run_at) where status in ('scheduled','failed');

-- O contato/conversa precisa pertencer à mesma organização/conexão do registro filho.
create or replace function public.protect_whatsapp_operational_tenant()
returns trigger language plpgsql set search_path = '' as $$
declare v_org uuid; v_connection uuid;
begin
  if tg_table_name = 'whatsapp_conversations' then
    select organization_id, connection_id into v_org, v_connection
      from public.whatsapp_contacts where id = new.contact_id;
  else
    select organization_id, connection_id into v_org, v_connection
      from public.whatsapp_conversations where id = new.conversation_id;
  end if;
  if v_org is distinct from new.organization_id or v_connection is distinct from new.connection_id then
    raise exception 'WhatsApp tenant mismatch' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists protect_whatsapp_conversation_tenant on public.whatsapp_conversations;
create trigger protect_whatsapp_conversation_tenant before insert or update on public.whatsapp_conversations
  for each row execute function public.protect_whatsapp_operational_tenant();
drop trigger if exists protect_whatsapp_message_tenant on public.whatsapp_messages;
create trigger protect_whatsapp_message_tenant before insert or update on public.whatsapp_messages
  for each row execute function public.protect_whatsapp_operational_tenant();
drop trigger if exists protect_whatsapp_conversation_event_tenant on public.whatsapp_conversation_events;
create trigger protect_whatsapp_conversation_event_tenant before insert or update on public.whatsapp_conversation_events
  for each row execute function public.protect_whatsapp_operational_tenant();
drop trigger if exists protect_whatsapp_follow_up_tenant on public.whatsapp_follow_ups;
create trigger protect_whatsapp_follow_up_tenant before insert or update on public.whatsapp_follow_ups
  for each row execute function public.protect_whatsapp_operational_tenant();

do $$ declare t text; begin
  foreach t in array array[
    'whatsapp_contacts','whatsapp_conversations','whatsapp_messages','whatsapp_webhook_events',
    'whatsapp_conversation_events','whatsapp_follow_ups'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (organization_id = public.current_organization_id() and public.is_active_user())',
      t || '_read', t
    );
  end loop;
end $$;

do $$ declare t text; begin
  foreach t in array array['whatsapp_contacts','whatsapp_conversations','whatsapp_messages','whatsapp_follow_ups'] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

comment on table public.whatsapp_messages is 'Histórico canônico do CRM; provider_message_id reconcilia webhooks Meta e respostas do MugoZap.';
comment on table public.whatsapp_webhook_events is 'Ledger idempotente de webhooks; guarda somente chave e hash, não o payload bruto.';
comment on table public.whatsapp_follow_ups is 'Fila durável de follow-up por conversa/conexão/organização.';
