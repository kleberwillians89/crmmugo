-- Sprint 1.2: PREPARAR APENAS. Nao aplicar fora de staging aprovado.

alter table public.whatsapp_connections
  add column if not exists source_version bigint not null default 1;

alter table public.whatsapp_connections
  drop constraint if exists whatsapp_connections_source_version_positive;
alter table public.whatsapp_connections
  add constraint whatsapp_connections_source_version_positive check (source_version > 0);

create unique index if not exists whatsapp_connections_org_workspace_uidx
  on public.whatsapp_connections(organization_id, workspace_id);

create table if not exists public.whatsapp_connection_outbox (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null default gen_random_uuid(),
  event_type text not null,
  aggregate_type text not null default 'whatsapp_connection',
  aggregate_id uuid not null references public.whatsapp_connections(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  payload jsonb not null,
  source_version bigint not null,
  occurred_at timestamptz not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  last_error_code text,
  last_error_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_connection_outbox_event_uidx unique(event_id),
  constraint whatsapp_connection_outbox_version_uidx unique(aggregate_id, source_version),
  constraint whatsapp_connection_outbox_event_type_check check (
    event_type in (
      'connection.created',
      'connection.updated',
      'connection.disabled',
      'connection.revoked',
      'connection.health_updated'
    )
  ),
  constraint whatsapp_connection_outbox_aggregate_type_check check (
    aggregate_type = 'whatsapp_connection'
  ),
  constraint whatsapp_connection_outbox_status_check check (
    status in ('pending','processing','delivered','failed','dead_letter')
  ),
  constraint whatsapp_connection_outbox_source_version_check check (source_version > 0),
  constraint whatsapp_connection_outbox_attempts_check check (attempts >= 0),
  constraint whatsapp_connection_outbox_payload_object check (jsonb_typeof(payload) = 'object')
);

create index if not exists whatsapp_connection_outbox_pending_idx
  on public.whatsapp_connection_outbox(status, next_attempt_at, occurred_at)
  where status in ('pending','failed');
create index if not exists whatsapp_connection_outbox_aggregate_idx
  on public.whatsapp_connection_outbox(aggregate_id, source_version desc);
create index if not exists whatsapp_connection_outbox_org_idx
  on public.whatsapp_connection_outbox(organization_id, occurred_at desc);
create index if not exists whatsapp_connection_outbox_locked_idx
  on public.whatsapp_connection_outbox(locked_at)
  where status = 'processing';

create or replace function public.whatsapp_jsonb_has_secret_key(value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  item record;
begin
  if value is null then return false; end if;
  if jsonb_typeof(value) = 'object' then
    for item in select key, value as child from jsonb_each(value)
    loop
      if lower(item.key) in (
        'token','access_token','app_secret','verify_token','authorization',
        'password','service_role','service_role_key','hmac_secret'
      ) then return true; end if;
      if jsonb_typeof(item.child) in ('object','array')
        and public.whatsapp_jsonb_has_secret_key(item.child)
      then return true; end if;
    end loop;
  elsif jsonb_typeof(value) = 'array' then
    for item in select child from jsonb_array_elements(value) as child
    loop
      if jsonb_typeof(item.child) in ('object','array')
        and public.whatsapp_jsonb_has_secret_key(item.child)
      then return true; end if;
    end loop;
  end if;
  return false;
end
$$;

alter table public.whatsapp_connection_outbox
  drop constraint if exists whatsapp_connection_outbox_no_secrets;
alter table public.whatsapp_connection_outbox
  add constraint whatsapp_connection_outbox_no_secrets
  check (not public.whatsapp_jsonb_has_secret_key(payload));

drop trigger if exists set_updated_at on public.whatsapp_connection_outbox;
create trigger set_updated_at before update on public.whatsapp_connection_outbox
for each row execute function public.set_updated_at();

create or replace function public.version_whatsapp_connection()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.source_version := greatest(coalesce(new.source_version, 1), 1);
    return new;
  end if;

  if (
    new.organization_id,
    new.workspace_id,
    new.provider,
    new.waba_id,
    new.phone_number_id,
    new.display_phone_number,
    new.verified_name,
    new.status,
    new.graph_api_version,
    new.credential_reference,
    new.capabilities,
    new.connection_health
  ) is distinct from (
    old.organization_id,
    old.workspace_id,
    old.provider,
    old.waba_id,
    old.phone_number_id,
    old.display_phone_number,
    old.verified_name,
    old.status,
    old.graph_api_version,
    old.credential_reference,
    old.capabilities,
    old.connection_health
  ) then
    new.source_version := old.source_version + 1;
  else
    new.source_version := old.source_version;
  end if;
  return new;
end
$$;

drop trigger if exists version_whatsapp_connection on public.whatsapp_connections;
create trigger version_whatsapp_connection
before insert or update on public.whatsapp_connections
for each row execute function public.version_whatsapp_connection();

create or replace function public.enqueue_whatsapp_connection_projection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_name text;
  projection_changed boolean;
  only_health_changed boolean;
  projection_payload jsonb;
begin
  if tg_op = 'INSERT' then
    event_name := 'connection.created';
    projection_changed := true;
    only_health_changed := false;
  else
    projection_changed := (
      new.organization_id,
      new.workspace_id,
      new.provider,
      new.waba_id,
      new.phone_number_id,
      new.display_phone_number,
      new.verified_name,
      new.status,
      new.graph_api_version,
      new.credential_reference,
      new.capabilities,
      new.connection_health
    ) is distinct from (
      old.organization_id,
      old.workspace_id,
      old.provider,
      old.waba_id,
      old.phone_number_id,
      old.display_phone_number,
      old.verified_name,
      old.status,
      old.graph_api_version,
      old.credential_reference,
      old.capabilities,
      old.connection_health
    );

    if not projection_changed then return new; end if;

    only_health_changed := (
      new.connection_health is distinct from old.connection_health
      and (
        new.organization_id,
        new.workspace_id,
        new.provider,
        new.waba_id,
        new.phone_number_id,
        new.display_phone_number,
        new.verified_name,
        new.status,
        new.graph_api_version,
        new.credential_reference,
        new.capabilities
      ) is not distinct from (
        old.organization_id,
        old.workspace_id,
        old.provider,
        old.waba_id,
        old.phone_number_id,
        old.display_phone_number,
        old.verified_name,
        old.status,
        old.graph_api_version,
        old.credential_reference,
        old.capabilities
      )
    );

    event_name := case
      when new.status = 'revoked' and old.status is distinct from 'revoked' then 'connection.revoked'
      when new.status = 'disabled' and old.status is distinct from 'disabled' then 'connection.disabled'
      when only_health_changed then 'connection.health_updated'
      else 'connection.updated'
    end;
  end if;

  projection_payload := jsonb_build_object(
    'event_id', gen_random_uuid(),
    'event_type', event_name,
    'occurred_at', now(),
    'version', new.source_version,
    'connection', jsonb_build_object(
      'id', new.id,
      'organization_id', new.organization_id,
      'workspace_id', new.workspace_id,
      'provider', new.provider,
      'waba_id', new.waba_id,
      'phone_number_id', new.phone_number_id,
      'display_phone_number_masked', case
        when nullif(regexp_replace(coalesce(new.display_phone_number, ''), '\D', '', 'g'), '') is null then null
        else '****' || right(regexp_replace(new.display_phone_number, '\D', '', 'g'), 4)
      end,
      'verified_name', new.verified_name,
      'status', new.status,
      'graph_api_version', new.graph_api_version,
      'credential_reference', new.credential_reference,
      'capabilities', new.capabilities,
      'connection_health', new.connection_health,
      'updated_at', new.updated_at
    )
  );

  insert into public.whatsapp_connection_outbox(
    event_id,
    event_type,
    aggregate_id,
    organization_id,
    payload,
    source_version,
    occurred_at
  )
  values(
    (projection_payload->>'event_id')::uuid,
    event_name,
    new.id,
    new.organization_id,
    projection_payload,
    new.source_version,
    (projection_payload->>'occurred_at')::timestamptz
  );
  return new;
end
$$;

drop trigger if exists enqueue_whatsapp_connection_projection on public.whatsapp_connections;
create trigger enqueue_whatsapp_connection_projection
after insert or update on public.whatsapp_connections
for each row execute function public.enqueue_whatsapp_connection_projection();

alter table public.whatsapp_connection_outbox enable row level security;
alter table public.whatsapp_connection_outbox force row level security;
revoke all on public.whatsapp_connection_outbox from public, anon, authenticated;
grant select, insert, update on public.whatsapp_connection_outbox to service_role;

create or replace function public.claim_whatsapp_connection_outbox(
  p_worker_id text,
  p_limit integer default 20,
  p_max_attempts integer default 8
)
returns setof public.whatsapp_connection_outbox
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
    select item.id
    from public.whatsapp_connection_outbox item
    where item.status in ('pending','failed')
      and coalesce(item.next_attempt_at,now()) <= now()
      and item.attempts < greatest(p_max_attempts,1)
    order by item.occurred_at
    for update skip locked
    limit least(greatest(p_limit,1),100)
  )
  update public.whatsapp_connection_outbox item
  set
    status='processing',
    locked_at=now(),
    locked_by=left(p_worker_id,120),
    attempts=item.attempts+1,
    updated_at=now()
  from candidates
  where item.id=candidates.id
  returning item.*;
end
$$;

revoke all on function public.claim_whatsapp_connection_outbox(text,integer,integer)
  from public, anon, authenticated;
grant execute on function public.claim_whatsapp_connection_outbox(text,integer,integer)
  to service_role;

comment on table public.whatsapp_connection_outbox is
  'Technical transactional outbox. Never exposed to frontend roles.';
