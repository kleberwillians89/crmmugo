-- Sprint 13.1: team_members e UUIDs como fonte única de responsáveis.
create table if not exists public.responsibility_migration_issues(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  entity_type text not null check(entity_type in('proposal','contract')),
  entity_id uuid not null,
  legacy_name text not null,
  created_at timestamptz not null default now(),
  unique(entity_type,entity_id)
);
alter table public.responsibility_migration_issues enable row level security;
drop policy if exists responsibility_migration_issues_admin on public.responsibility_migration_issues;
create policy responsibility_migration_issues_admin on public.responsibility_migration_issues for select to authenticated
using(organization_id=public.current_organization_id() and public.is_admin());

-- Resolve primeiro correspondências exatas, ignorando caixa e espaços laterais.
update public.proposals p set responsible_id=t.id
from public.team_members t
where p.responsible_id is null and nullif(trim(p.responsible),'') is not null
  and t.organization_id=p.organization_id and lower(trim(t.name))=lower(trim(p.responsible));
update public.contracts c set responsible_id=t.id
from public.team_members t
where c.responsible_id is null and nullif(trim(c.responsible),'') is not null
  and t.organization_id=c.organization_id and lower(trim(t.name))=lower(trim(c.responsible));

-- Preserva para diagnóstico qualquer nome legado sem correspondência antes de desativar o texto.
insert into public.responsibility_migration_issues(organization_id,entity_type,entity_id,legacy_name)
select organization_id,'proposal',id,trim(responsible) from public.proposals
where responsible_id is null and nullif(trim(responsible),'') is not null
on conflict(entity_type,entity_id) do update set legacy_name=excluded.legacy_name;
insert into public.responsibility_migration_issues(organization_id,entity_type,entity_id,legacy_name)
select organization_id,'contract',id,trim(responsible) from public.contracts
where responsible_id is null and nullif(trim(responsible),'') is not null
on conflict(entity_type,entity_id) do update set legacy_name=excluded.legacy_name;

update public.proposals set responsible=null where responsible is not null;
update public.contracts set responsible=null where responsible is not null;
alter table public.proposals drop constraint if exists proposals_responsible_text_disabled;
alter table public.proposals add constraint proposals_responsible_text_disabled check(responsible is null);
alter table public.contracts drop constraint if exists contracts_responsible_text_disabled;
alter table public.contracts add constraint contracts_responsible_text_disabled check(responsible is null);

-- O normalizador histórico também passa a resolver exclusivamente pela equipe operacional.
create or replace function public.normalize_legacy_commercial_data() returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid:=public.current_organization_id();before_data jsonb;after_data jsonb;
begin
  if not public.is_admin() then raise exception 'Apenas administradores podem executar a normalização.';end if;
  select jsonb_build_object('proposals_without_services',(select count(*) from public.proposals p where p.organization_id=org and p.deleted_at is null and not exists(select 1 from public.proposal_services s where s.proposal_id=p.id)),'proposals_without_responsible',(select count(*) from public.proposals p where p.organization_id=org and p.deleted_at is null and p.responsible_id is null),'documents_without_relationship',(select count(*) from public.documents d where d.organization_id=org and d.proposal_id is null and d.contract_id is null)) into before_data;
  update public.proposals p set responsible_id=t.id from public.team_members t where p.organization_id=org and t.organization_id=org and p.responsible_id is null and exists(select 1 from public.responsibility_migration_issues i where i.entity_type='proposal' and i.entity_id=p.id and lower(trim(i.legacy_name))=lower(trim(t.name)));
  insert into public.proposal_services(organization_id,proposal_id,service_name,service_category,billing_type,quantity,unit_price,monthly_value,one_time_value)
  select p.organization_id,p.id,s->'service_name'->>'value',s->'service_category'->>'value',s->'billing_type'->>'value',nullif(s->'quantity'->>'value','')::numeric,nullif(s->'unit_price'->>'value','')::numeric,nullif(s->'monthly_value'->>'value','')::numeric,nullif(s->'one_time_value'->>'value','')::numeric
  from public.proposals p join public.documents d on d.proposal_id=p.id join public.document_analyses a on a.confirmed_document_id=d.id cross join lateral jsonb_array_elements(coalesce(a.extracted_data->'extractedData'->'services','[]'::jsonb)) s
  where p.organization_id=org and p.deleted_at is null and not exists(select 1 from public.proposal_services ps where ps.proposal_id=p.id) and nullif(s->'service_name'->>'value','') is not null;
  update public.proposals p set title=coalesce(nullif(p.title,''),nullif(a.extracted_data->'extractedData'->'proposal'->'title'->>'value',''),c.company_name) from public.documents d join public.document_analyses a on a.confirmed_document_id=d.id,public.clients c where d.proposal_id=p.id and c.id=p.client_id and p.organization_id=org;
  select jsonb_build_object('proposals_without_services',(select count(*) from public.proposals p where p.organization_id=org and p.deleted_at is null and not exists(select 1 from public.proposal_services s where s.proposal_id=p.id)),'proposals_without_responsible',(select count(*) from public.proposals p where p.organization_id=org and p.deleted_at is null and p.responsible_id is null),'documents_without_relationship',(select count(*) from public.documents d where d.organization_id=org and d.proposal_id is null and d.contract_id is null)) into after_data;
  insert into public.commercial_normalization_runs(organization_id,executed_by,before_report,after_report) values(org,auth.uid(),before_data,after_data);
  return jsonb_build_object('before',before_data,'after',after_data);
end$$;

create or replace function public.team_responsibility_diagnostic() returns jsonb language sql security definer set search_path='' as $$
select case when public.is_admin() then jsonb_build_object(
  'activeTeamMembers',(select count(*) from public.team_members where organization_id=public.current_organization_id() and active),
  'proposalsWithoutResponsible',(select count(*) from public.proposals where organization_id=public.current_organization_id() and deleted_at is null and responsible_id is null),
  'contractsWithoutResponsible',(select count(*) from public.contracts where organization_id=public.current_organization_id() and deleted_at is null and responsible_id is null),
  'unresolvedLegacyNames',(select count(*) from public.responsibility_migration_issues where organization_id=public.current_organization_id())
) else null end $$;
grant execute on function public.team_responsibility_diagnostic() to authenticated;
