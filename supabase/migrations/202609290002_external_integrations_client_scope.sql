-- Corrige granularidade de external_integrations: organization_id sozinho não basta (uma organização
-- tem vários clients — Roove, Origami, Curavino...). Sem client_id, um mapping resolveria a
-- organização inteira e a API vazaria dados entre clientes da mesma organização.
--
-- A migration 202609290001 já foi aplicada em produção com a tabela vazia — por isso esta é uma
-- migration corretiva NOVA (não edita a 202609290001 retroativamente). NÃO aplicada em produção
-- automaticamente nesta tarefa.

alter table public.external_integrations
  add column if not exists client_id uuid references public.clients(id) on delete restrict;

-- client_id é obrigatório a partir de agora (a tabela está vazia em produção, então not null direto
-- não quebra nada; nenhuma linha existente precisa de backfill).
alter table public.external_integrations
  alter column client_id set not null;

alter table public.external_integrations
  drop constraint if exists external_integrations_organization_id_provider_key;
alter table public.external_integrations
  add constraint external_integrations_organization_id_client_id_provider_key unique(organization_id, client_id, provider);
-- unique(provider, external_client_id) já existe desde a 202609290001 e continua válida sem mudança.

drop index if exists external_integrations_lookup_idx;
create index if not exists external_integrations_lookup_idx
  on public.external_integrations(provider, external_client_id) where status='active';
create index if not exists external_integrations_client_idx
  on public.external_integrations(organization_id, client_id);

-- Mesmo padrão já usado por protect_whatsapp_operational_tenant (202608310003): trigger que confere,
-- no próprio banco, que client_id realmente pertence a organization_id — nunca confia só na aplicação.
create or replace function public.protect_external_integration_tenant()
returns trigger language plpgsql set search_path = '' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.clients where id = new.client_id;
  if v_org is distinct from new.organization_id then
    raise exception 'external_integrations tenant mismatch: client_id does not belong to organization_id' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists protect_external_integration_tenant on public.external_integrations;
create trigger protect_external_integration_tenant before insert or update on public.external_integrations
  for each row execute function public.protect_external_integration_tenant();

comment on column public.external_integrations.client_id is 'Cliente específico dentro da organização (ex.: Roove) — sem isso o mapping resolveria a organização inteira e vazaria dados entre clientes. Consistência com organization_id garantida por trigger, não só pela aplicação.';
