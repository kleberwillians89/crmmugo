-- Sprint 11: arquivamento comercial, responsável estruturado e normalização segura.
alter table public.proposals add column if not exists responsible_id uuid references public.profiles(id),add column if not exists deleted_at timestamptz,add column if not exists deleted_by uuid references auth.users(id);
alter table public.clients add column if not exists deleted_at timestamptz,add column if not exists deleted_by uuid references auth.users(id);
alter table public.contracts add column if not exists deleted_at timestamptz,add column if not exists deleted_by uuid references auth.users(id);
create index if not exists proposals_org_active on public.proposals(organization_id,created_at desc) where deleted_at is null;
create index if not exists clients_org_active on public.clients(organization_id,created_at desc) where deleted_at is null;
create index if not exists contracts_org_active on public.contracts(organization_id,created_at desc) where deleted_at is null;

create table if not exists public.commercial_normalization_runs(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),executed_by uuid references auth.users(id),before_report jsonb not null,after_report jsonb not null,created_at timestamptz default now());
alter table public.commercial_normalization_runs enable row level security;
create policy commercial_normalization_runs_admin on public.commercial_normalization_runs for select to authenticated using(organization_id=public.current_organization_id() and public.is_admin());

create or replace function public.normalize_legacy_commercial_data() returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid:=public.current_organization_id();before_data jsonb;after_data jsonb;
begin
  if not public.is_admin() then raise exception 'Apenas administradores podem executar a normalização.';end if;
  select jsonb_build_object('proposals_without_services',(select count(*) from public.proposals p where p.organization_id=org and p.deleted_at is null and not exists(select 1 from public.proposal_services s where s.proposal_id=p.id)),'proposals_without_responsible',(select count(*) from public.proposals p where p.organization_id=org and p.deleted_at is null and nullif(trim(p.responsible),'') is null),'documents_without_relationship',(select count(*) from public.documents d where d.organization_id=org and d.proposal_id is null and d.contract_id is null)) into before_data;
  update public.proposals p set responsible_id=pr.id from public.profiles pr where p.organization_id=org and pr.organization_id=org and p.responsible_id is null and nullif(trim(p.responsible),'') is not null and lower(trim(pr.name))=lower(trim(p.responsible));
  insert into public.proposal_services(organization_id,proposal_id,service_name,service_category,billing_type,quantity,unit_price,monthly_value,one_time_value)
  select p.organization_id,p.id,s->'service_name'->>'value',s->'service_category'->>'value',s->'billing_type'->>'value',nullif(s->'quantity'->>'value','')::numeric,nullif(s->'unit_price'->>'value','')::numeric,nullif(s->'monthly_value'->>'value','')::numeric,nullif(s->'one_time_value'->>'value','')::numeric
  from public.proposals p join public.documents d on d.proposal_id=p.id join public.document_analyses a on a.confirmed_document_id=d.id cross join lateral jsonb_array_elements(coalesce(a.extracted_data->'extractedData'->'services','[]'::jsonb)) s
  where p.organization_id=org and p.deleted_at is null and not exists(select 1 from public.proposal_services ps where ps.proposal_id=p.id) and nullif(s->'service_name'->>'value','') is not null;
  update public.proposals p set title=coalesce(nullif(p.title,''),nullif(a.extracted_data->'extractedData'->'proposal'->'title'->>'value',''),c.company_name),responsible=coalesce(nullif(p.responsible,''),nullif(a.extracted_data->'extractedData'->'proposal'->'responsible'->>'value','')) from public.documents d join public.document_analyses a on a.confirmed_document_id=d.id,public.clients c where d.proposal_id=p.id and c.id=p.client_id and p.organization_id=org;
  select jsonb_build_object('proposals_without_services',(select count(*) from public.proposals p where p.organization_id=org and p.deleted_at is null and not exists(select 1 from public.proposal_services s where s.proposal_id=p.id)),'proposals_without_responsible',(select count(*) from public.proposals p where p.organization_id=org and p.deleted_at is null and nullif(trim(p.responsible),'') is null),'documents_without_relationship',(select count(*) from public.documents d where d.organization_id=org and d.proposal_id is null and d.contract_id is null)) into after_data;
  insert into public.commercial_normalization_runs(organization_id,executed_by,before_report,after_report) values(org,auth.uid(),before_data,after_data);
  return jsonb_build_object('before',before_data,'after',after_data);
end$$;
grant execute on function public.normalize_legacy_commercial_data() to authenticated;

create or replace function public.permanently_delete_proposal(target uuid) returns void language plpgsql security definer set search_path='' as $$begin
  if not public.is_admin() then raise exception 'Apenas administradores podem excluir definitivamente.';end if;
  if exists(select 1 from public.contracts where proposal_id=target) then raise exception 'A proposta possui contrato e não pode ser excluída.';end if;
  delete from public.commercial_events where proposal_id=target and organization_id=public.current_organization_id();
  delete from public.documents where proposal_id=target and organization_id=public.current_organization_id();
  delete from public.proposals where id=target and organization_id=public.current_organization_id() and deleted_at is not null;
end$$;
grant execute on function public.permanently_delete_proposal(uuid) to authenticated;
