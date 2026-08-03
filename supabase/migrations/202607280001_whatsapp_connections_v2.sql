-- Sprint 1: PREPARAR APENAS. Nao aplicar antes do gate descrito em
-- docs/whatsapp-sprint-1-environment-validation.md.

create table if not exists public.whatsapp_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  workspace_id text not null,
  provider text not null default 'meta_cloud_api',
  waba_id text,
  phone_number_id text,
  display_phone_number text,
  verified_name text,
  status text not null default 'draft',
  graph_api_version text,
  credential_reference text,
  webhook_verify_reference text,
  connection_health jsonb not null default '{}'::jsonb,
  capabilities jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz,
  last_health_check_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_connections_workspace_required check (length(trim(workspace_id)) between 1 and 120),
  constraint whatsapp_connections_provider_check check (provider = 'meta_cloud_api'),
  constraint whatsapp_connections_status_check check (
    status in ('draft','connecting','active','degraded','disabled','revoked','error')
  ),
  constraint whatsapp_connections_waba_digits check (waba_id is null or waba_id ~ '^[0-9]+$'),
  constraint whatsapp_connections_phone_id_digits check (phone_number_id is null or phone_number_id ~ '^[0-9]+$'),
  constraint whatsapp_connections_graph_version check (
    graph_api_version is null or graph_api_version ~ '^v[0-9]+\.[0-9]+$'
  ),
  constraint whatsapp_connections_active_configuration check (
    status <> 'active'
    or (
      waba_id is not null
      and phone_number_id is not null
      and credential_reference is not null
      and length(trim(credential_reference)) > 0
    )
  ),
  constraint whatsapp_connections_health_object check (jsonb_typeof(connection_health) = 'object'),
  constraint whatsapp_connections_capabilities_object check (jsonb_typeof(capabilities) = 'object'),
  constraint whatsapp_connections_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint whatsapp_connections_no_secret_metadata check (
    not (metadata ?| array['token','access_token','app_secret','verify_token','authorization','password'])
  )
);

create unique index if not exists whatsapp_connections_provider_phone_uidx
  on public.whatsapp_connections(provider, phone_number_id)
  where phone_number_id is not null;

create unique index if not exists whatsapp_connections_org_provider_waba_phone_uidx
  on public.whatsapp_connections(organization_id, provider, waba_id, phone_number_id)
  where waba_id is not null and phone_number_id is not null;

create unique index if not exists whatsapp_connections_active_phone_uidx
  on public.whatsapp_connections(phone_number_id)
  where phone_number_id is not null and status = 'active';

create index if not exists whatsapp_connections_org_idx
  on public.whatsapp_connections(organization_id);
create index if not exists whatsapp_connections_org_status_idx
  on public.whatsapp_connections(organization_id, status);
create index if not exists whatsapp_connections_phone_idx
  on public.whatsapp_connections(phone_number_id);
create index if not exists whatsapp_connections_workspace_idx
  on public.whatsapp_connections(workspace_id);
create index if not exists whatsapp_connections_provider_phone_idx
  on public.whatsapp_connections(provider, phone_number_id);
create index if not exists whatsapp_connections_status_health_idx
  on public.whatsapp_connections(status, last_health_check_at);

drop trigger if exists set_updated_at on public.whatsapp_connections;
create trigger set_updated_at before update on public.whatsapp_connections
for each row execute function public.set_updated_at();

create or replace function public.protect_whatsapp_connection_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' and (
    new.organization_id is distinct from old.organization_id
    or new.workspace_id is distinct from old.workspace_id
    or new.credential_reference is distinct from old.credential_reference
    or new.webhook_verify_reference is distinct from old.webhook_verify_reference
  ) then
    raise exception 'Campos protegidos da conexão não podem ser alterados pelo cliente.'
      using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists protect_whatsapp_connection_identity on public.whatsapp_connections;
create trigger protect_whatsapp_connection_identity
before update on public.whatsapp_connections
for each row execute function public.protect_whatsapp_connection_identity();

alter table public.whatsapp_connections enable row level security;
alter table public.whatsapp_connections force row level security;

drop policy if exists whatsapp_connections_read on public.whatsapp_connections;
create policy whatsapp_connections_read
on public.whatsapp_connections for select to authenticated
using (
  organization_id = public.current_organization_id()
  and public.is_active_user()
);

drop policy if exists whatsapp_connections_admin_insert on public.whatsapp_connections;
create policy whatsapp_connections_admin_insert
on public.whatsapp_connections for insert to authenticated
with check (
  organization_id = public.current_organization_id()
  and public.current_user_role() = 'admin'
  and status in ('draft','connecting')
  and credential_reference is null
  and webhook_verify_reference is null
);

drop policy if exists whatsapp_connections_admin_update on public.whatsapp_connections;
create policy whatsapp_connections_admin_update
on public.whatsapp_connections for update to authenticated
using (
  organization_id = public.current_organization_id()
  and public.current_user_role() = 'admin'
)
with check (
  organization_id = public.current_organization_id()
  and public.current_user_role() = 'admin'
);

revoke all on public.whatsapp_connections from anon, authenticated;

grant select (
  id, organization_id, provider, display_phone_number, verified_name, status,
  connection_health, capabilities, last_sync_at, last_health_check_at,
  created_at, updated_at
) on public.whatsapp_connections to authenticated;

grant insert (
  organization_id, workspace_id, provider, waba_id, phone_number_id,
  display_phone_number, verified_name, status, graph_api_version,
  connection_health, capabilities, metadata
) on public.whatsapp_connections to authenticated;

grant update (
  display_phone_number, verified_name, status, graph_api_version,
  connection_health, capabilities, metadata, last_sync_at, last_health_check_at
) on public.whatsapp_connections to authenticated;

create or replace view public.whatsapp_connections_public
with (security_invoker = true, security_barrier = true)
as
select
  id,
  organization_id,
  provider,
  case
    when nullif(regexp_replace(coalesce(display_phone_number, ''), '\D', '', 'g'), '') is null then null
    else '****' || right(regexp_replace(display_phone_number, '\D', '', 'g'), 4)
  end as display_phone_number,
  verified_name,
  status,
  connection_health,
  capabilities,
  last_sync_at,
  last_health_check_at,
  created_at,
  updated_at
from public.whatsapp_connections;

revoke all on public.whatsapp_connections_public from anon;
grant select on public.whatsapp_connections_public to authenticated;

create or replace function public.get_whatsapp_connection_public(p_connection_id uuid)
returns setof public.whatsapp_connections_public
language sql
stable
security invoker
set search_path = ''
as $$
  select connection.*
  from public.whatsapp_connections_public connection
  where connection.id = p_connection_id
$$;

grant execute on function public.get_whatsapp_connection_public(uuid) to authenticated;

create or replace function public.resolve_whatsapp_connection_shadow(
  p_connection_id uuid,
  p_legacy_workspace_id text
)
returns table (
  id uuid,
  organization_id uuid,
  provider text,
  display_phone_number text,
  verified_name text,
  status text,
  connection_health jsonb,
  capabilities jsonb,
  workspace_match boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    connection.id,
    connection.organization_id,
    connection.provider,
    case
      when nullif(regexp_replace(coalesce(connection.display_phone_number, ''), '\D', '', 'g'), '') is null then null
      else '****' || right(regexp_replace(connection.display_phone_number, '\D', '', 'g'), 4)
    end,
    connection.verified_name,
    connection.status,
    connection.connection_health,
    connection.capabilities,
    connection.workspace_id = p_legacy_workspace_id
  from public.whatsapp_connections connection
  where connection.id = p_connection_id
    and connection.organization_id = public.current_organization_id()
    and public.is_active_user()
$$;

revoke all on function public.resolve_whatsapp_connection_shadow(uuid,text) from public, anon;
grant execute on function public.resolve_whatsapp_connection_shadow(uuid,text) to authenticated;

create or replace function public.register_legacy_whatsapp_connection(
  p_organization_id uuid,
  p_workspace_id text,
  p_waba_id text,
  p_phone_number_id text,
  p_graph_api_version text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection_id uuid;
begin
  if p_workspace_id is null or trim(p_workspace_id) = ''
    or p_waba_id !~ '^[0-9]+$'
    or p_phone_number_id !~ '^[0-9]+$'
    or (p_graph_api_version is not null and p_graph_api_version !~ '^v[0-9]+\.[0-9]+$')
  then
    raise exception 'Configuração legada inválida.' using errcode = '22023';
  end if;

  insert into public.whatsapp_connections(
    organization_id,
    workspace_id,
    provider,
    waba_id,
    phone_number_id,
    status,
    graph_api_version,
    credential_reference,
    metadata
  )
  values(
    p_organization_id,
    trim(p_workspace_id),
    'meta_cloud_api',
    p_waba_id,
    p_phone_number_id,
    'draft',
    p_graph_api_version,
    'env://legacy-default',
    '{"legacy":true,"source":"environment_variables"}'::jsonb
  )
  returning id into connection_id;

  return connection_id;
end
$$;

revoke all on function public.register_legacy_whatsapp_connection(uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.register_legacy_whatsapp_connection(uuid,text,text,text,text) to service_role;

comment on table public.whatsapp_connections is
  'Canonical CRM control-plane registry. Credentials are opaque references only.';
comment on column public.whatsapp_connections.credential_reference is
  'Opaque secret-provider reference. Never expose through frontend APIs.';
comment on column public.whatsapp_connections.webhook_verify_reference is
  'Opaque verification-secret reference. Never expose through frontend APIs.';
