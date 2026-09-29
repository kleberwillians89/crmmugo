-- Vínculo explícito entre organização do CRM e um provedor externo (ex.: Mugô Dados), nunca por nome.
-- NÃO aplicado em produção nesta tarefa — arquivo criado para revisão/aplicação manual.
-- Nenhum secret vive aqui: a chave de API do provedor (ex.: DATA_PLATFORM_API_KEY) fica só em
-- variável de ambiente da Edge Function, igual ao padrão já usado por task-command-worker/
-- collection-notification-worker/commercial-ai-worker.

create table if not exists public.external_integrations(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  provider text not null check(provider in('mugo_dados')),
  external_client_id text not null,
  status text not null default 'active' check(status in('active','disconnected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id, provider),
  unique(provider, external_client_id)
);
create index if not exists external_integrations_lookup_idx on public.external_integrations(provider, external_client_id) where status='active';

alter table public.external_integrations enable row level security;
alter table public.external_integrations force row level security;
-- Somente admin autorizado configura — leitura/escrita exigem is_admin(), igual ao padrão de
-- organizations_admin/profiles_admin já usado no schema.
create policy external_integrations_admin on public.external_integrations for all to authenticated
  using(organization_id=public.current_organization_id() and public.is_admin())
  with check(organization_id=public.current_organization_id() and public.is_admin());

create trigger set_updated_at before update on public.external_integrations
  for each row execute function public.set_updated_at();

comment on table public.external_integrations is 'Vínculo organization_id <-> identificador externo por provedor (ex.: Mugô Dados). Nunca guarda secrets; a chave de API do provedor fica em env/Vault da Edge Function correspondente.';
comment on column public.external_integrations.external_client_id is 'Identificador do tenant no sistema externo (ex.: client_id do Mugô Dados) — nunca o nome da empresa.';
