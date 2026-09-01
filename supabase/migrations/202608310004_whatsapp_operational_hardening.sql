-- Hardening posterior às migrations 202608310001/202608310002 já aplicadas.
-- Aditiva, sem reexecutar backfills históricos e sem apagar dados.

-- 1. Isolamento de tenant entre fluxo e versão ------------------------------------------
create or replace function public.protect_automation_version_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.automation_flows where id = new.flow_id;
  if v_org is null or v_org is distinct from new.organization_id then
    raise exception 'automation version tenant mismatch' using errcode = '23514';
  end if;
  return new;
end
$$;

drop trigger if exists protect_automation_version_tenant on public.automation_versions;
create trigger protect_automation_version_tenant
  before insert or update on public.automation_versions
  for each row execute function public.protect_automation_version_tenant();

create or replace function public.protect_automation_active_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.active_version_id is not null and not exists (
    select 1
    from public.automation_versions v
    where v.id = new.active_version_id
      and v.flow_id = new.id
      and v.organization_id = new.organization_id
  ) then
    raise exception 'active version does not belong to flow' using errcode = '23514';
  end if;
  return new;
end
$$;

drop trigger if exists protect_automation_active_version on public.automation_flows;
create trigger protect_automation_active_version
  before insert or update on public.automation_flows
  for each row execute function public.protect_automation_active_version();

-- NOT VALID preserva linhas históricas eventualmente incompatíveis, mas passa a
-- rejeitar novos registros nulos/inválidos. A validação integral fica para um gate
-- separado após auditoria de dados no ambiente remoto.
alter table public.automation_versions
  drop constraint if exists automation_versions_organization_required;
alter table public.automation_versions
  add constraint automation_versions_organization_required
  check (organization_id is not null) not valid;

alter table public.automation_run_steps
  drop constraint if exists automation_run_steps_organization_required;
alter table public.automation_run_steps
  add constraint automation_run_steps_organization_required
  check (organization_id is not null) not valid;

alter table public.automation_flows
  drop constraint if exists automation_flows_name_minimum_hardening;
alter table public.automation_flows
  add constraint automation_flows_name_minimum_hardening
  check (length(trim(name)) between 2 and 120) not valid;

-- 2. O schema real de clients aceita lead, não opportunity. Substituir a função é
-- idempotente e não reprocessa clientes existentes.
create or replace function public.automation_on_lead_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'lead' then
    perform public.emit_automation_event(
      new.organization_id,
      'lead_created',
      new.id::text,
      jsonb_build_object(
        'subject_type', 'client',
        'client_id', new.id,
        'status', new.status,
        'segment', new.segment,
        'lead_source', new.lead_source
      ),
      'lead_created:' || new.id::text
    );
  end if;
  return new;
end
$$;

revoke all on function public.automation_on_lead_created() from public, anon, authenticated;

comment on function public.protect_automation_version_tenant() is
  'Hardening aditivo: impede version de apontar para flow de outro tenant.';
comment on function public.protect_automation_active_version() is
  'Hardening aditivo: active_version_id precisa pertencer ao mesmo flow e tenant.';

-- 3. Todo vínculo operacional deve herdar o tenant da conexão canônica. Isso
-- também protege escritas service_role do webhook contra associações cruzadas.
create or replace function public.protect_whatsapp_contact_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_connection_org uuid; v_client_org uuid;
begin
  select organization_id into v_connection_org
    from public.whatsapp_connections where id = new.connection_id;
  if v_connection_org is null or v_connection_org is distinct from new.organization_id then
    raise exception 'WhatsApp contact connection tenant mismatch' using errcode = '23514';
  end if;
  if new.client_id is not null then
    select organization_id into v_client_org from public.clients where id = new.client_id;
    if v_client_org is null or v_client_org is distinct from new.organization_id then
      raise exception 'WhatsApp contact client tenant mismatch' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists protect_whatsapp_contact_tenant on public.whatsapp_contacts;
create trigger protect_whatsapp_contact_tenant
  before insert or update on public.whatsapp_contacts
  for each row execute function public.protect_whatsapp_contact_tenant();

create or replace function public.protect_whatsapp_webhook_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_connection_org uuid;
begin
  select organization_id into v_connection_org
    from public.whatsapp_connections where id = new.connection_id;
  if v_connection_org is null or v_connection_org is distinct from new.organization_id then
    raise exception 'WhatsApp webhook connection tenant mismatch' using errcode = '23514';
  end if;
  return new;
end
$$;

drop trigger if exists protect_whatsapp_webhook_tenant on public.whatsapp_webhook_events;
create trigger protect_whatsapp_webhook_tenant
  before insert or update on public.whatsapp_webhook_events
  for each row execute function public.protect_whatsapp_webhook_tenant();

-- Se um status chegar nos milissegundos entre a resposta da Meta e a gravação
-- outbound, o ledger já existente é aplicado quando a mensagem for inserida.
create or replace function public.reconcile_whatsapp_message_status()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_event_type text; v_occurred_at timestamptz;
begin
  if new.provider_message_id is null then return new; end if;
  select event_type, processed_at into v_event_type, v_occurred_at
  from public.whatsapp_webhook_events
  where connection_id = new.connection_id
    and left(event_key, length('status:' || new.provider_message_id || ':')) = 'status:' || new.provider_message_id || ':'
    and event_type in ('message_sent','message_delivered','message_read','message_failed')
  order by case event_type
    when 'message_read' then 5
    when 'message_delivered' then 4
    when 'message_failed' then 3
    when 'message_sent' then 2
    else 0 end desc,
    processed_at desc
  limit 1;
  if v_event_type is null then return new; end if;
  new.status := replace(v_event_type, 'message_', '');
  if v_event_type = 'message_sent' then new.sent_at := coalesce(new.sent_at, v_occurred_at); end if;
  if v_event_type = 'message_delivered' then new.delivered_at := coalesce(new.delivered_at, v_occurred_at); end if;
  if v_event_type = 'message_read' then new.read_at := coalesce(new.read_at, v_occurred_at); end if;
  if v_event_type = 'message_failed' then new.failed_at := coalesce(new.failed_at, v_occurred_at); end if;
  return new;
end
$$;

drop trigger if exists reconcile_whatsapp_message_status on public.whatsapp_messages;
create trigger reconcile_whatsapp_message_status
  before insert or update of provider_message_id on public.whatsapp_messages
  for each row execute function public.reconcile_whatsapp_message_status();

-- 4. Compatibilidade caso 202608310003 já tenha sido aplicada antes desta revisão.
alter table public.whatsapp_conversations
  add column if not exists unread_count integer not null default 0;
alter table public.whatsapp_conversations
  drop constraint if exists whatsapp_conversations_unread_nonnegative;
alter table public.whatsapp_conversations
  add constraint whatsapp_conversations_unread_nonnegative check (unread_count >= 0) not valid;

create or replace function public.increment_whatsapp_unread(p_conversation_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  update public.whatsapp_conversations
    set unread_count = unread_count + 1
    where id = p_conversation_id
    returning unread_count into v_count;
  return v_count;
end
$$;
revoke all on function public.increment_whatsapp_unread(uuid) from public, anon, authenticated;
grant execute on function public.increment_whatsapp_unread(uuid) to service_role;

create or replace function public.mark_whatsapp_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_write() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.whatsapp_conversations
    set unread_count = 0
    where id = p_conversation_id
      and organization_id = public.current_organization_id();
end
$$;
revoke all on function public.mark_whatsapp_conversation_read(uuid) from public, anon;
grant execute on function public.mark_whatsapp_conversation_read(uuid) to authenticated;
