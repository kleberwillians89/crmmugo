-- Sprint 12.2: responsáveis e escopo por serviço, sem alterar valores comerciais.
alter table public.contracts add column if not exists responsible_id uuid references public.profiles(id),add column if not exists responsible text;
alter table public.proposal_services
  add column if not exists commercial_responsible_id uuid references public.profiles(id),
  add column if not exists delivery_responsible_id uuid references public.profiles(id),
  add column if not exists support_responsible_id uuid references public.profiles(id),
  add column if not exists service_status text not null default 'planned',
  add column if not exists scope_summary text,
  add column if not exists deliverables text,
  add column if not exists commercial_notes text,
  add column if not exists operational_notes text,
  add column if not exists duration_months integer;
alter table public.contract_services
  add column if not exists commercial_responsible_id uuid references public.profiles(id),
  add column if not exists delivery_responsible_id uuid references public.profiles(id),
  add column if not exists support_responsible_id uuid references public.profiles(id),
  add column if not exists service_status text not null default 'planned',
  add column if not exists scope_summary text,
  add column if not exists deliverables text,
  add column if not exists commercial_notes text,
  add column if not exists operational_notes text,
  add column if not exists duration_months integer;
do $$declare item record;begin for item in select * from(values
  ('proposal_services','proposal_services_commercial_responsible_id_fkey','commercial_responsible_id'),('proposal_services','proposal_services_delivery_responsible_id_fkey','delivery_responsible_id'),('proposal_services','proposal_services_support_responsible_id_fkey','support_responsible_id'),
  ('contract_services','contract_services_commercial_responsible_id_fkey','commercial_responsible_id'),('contract_services','contract_services_delivery_responsible_id_fkey','delivery_responsible_id'),('contract_services','contract_services_support_responsible_id_fkey','support_responsible_id')
) as values_list(table_name,constraint_name,column_name) loop if not exists(select 1 from pg_catalog.pg_constraint where conname=item.constraint_name) then execute format('alter table public.%I add constraint %I foreign key(%I) references public.profiles(id)',item.table_name,item.constraint_name,item.column_name);end if;end loop;end$$;

alter table public.proposal_services drop constraint if exists proposal_services_service_status_check;
alter table public.proposal_services add constraint proposal_services_service_status_check check(service_status in('planned','negotiated','approved','active','paused','completed','cancelled','not_included'));
alter table public.contract_services drop constraint if exists contract_services_service_status_check;
alter table public.contract_services add constraint contract_services_service_status_check check(service_status in('planned','negotiated','approved','active','paused','completed','cancelled','not_included'));
alter table public.proposal_services drop constraint if exists proposal_services_duration_months_nonnegative;
alter table public.proposal_services add constraint proposal_services_duration_months_nonnegative check(duration_months is null or duration_months>=0);
alter table public.contract_services drop constraint if exists contract_services_duration_months_nonnegative;
alter table public.contract_services add constraint contract_services_duration_months_nonnegative check(duration_months is null or duration_months>=0);

create index if not exists proposal_services_commercial_responsible_idx on public.proposal_services(organization_id,commercial_responsible_id);
create index if not exists proposal_services_delivery_responsible_idx on public.proposal_services(organization_id,delivery_responsible_id);
create index if not exists proposal_services_support_responsible_idx on public.proposal_services(organization_id,support_responsible_id);
create index if not exists proposal_services_status_idx on public.proposal_services(organization_id,service_status);
create index if not exists contract_services_commercial_responsible_idx on public.contract_services(organization_id,commercial_responsible_id);
create index if not exists contract_services_delivery_responsible_idx on public.contract_services(organization_id,delivery_responsible_id);
create index if not exists contract_services_support_responsible_idx on public.contract_services(organization_id,support_responsible_id);
create index if not exists contract_services_status_idx on public.contract_services(organization_id,service_status);

-- As policies existentes usam can_write(): admin e manager editam; viewer apenas lê.
create or replace function public.service_responsibility_diagnostic() returns jsonb
language sql security definer set search_path='' as $$
select case when public.is_admin() then jsonb_build_object(
  'foreignKeysAvailable',(select count(*)>=6 from pg_catalog.pg_constraint where conrelid in('public.proposal_services'::regclass,'public.contract_services'::regclass) and contype='f' and conname like '%responsible%'),
  'responsibilityIndexesAvailable',(select count(*)>=6 from pg_catalog.pg_indexes where schemaname='public' and tablename in('proposal_services','contract_services') and indexname like '%responsible%'),
  'readPoliciesAvailable',(select count(*)>=2 from pg_catalog.pg_policies where schemaname='public' and tablename in('proposal_services','contract_services') and cmd in('SELECT','ALL')),
  'writePoliciesAvailable',(select count(*)>=2 from pg_catalog.pg_policies where schemaname='public' and tablename in('proposal_services','contract_services') and cmd='ALL'),
  'proposalServicesWithoutAnyResponsible',(select count(*) from public.proposal_services where organization_id=public.current_organization_id() and commercial_responsible_id is null and delivery_responsible_id is null and support_responsible_id is null),
  'contractServicesWithoutAnyResponsible',(select count(*) from public.contract_services where organization_id=public.current_organization_id() and commercial_responsible_id is null and delivery_responsible_id is null and support_responsible_id is null),
  'servicesWithoutStatus',(select (select count(*) from public.proposal_services where organization_id=public.current_organization_id() and service_status is null)+(select count(*) from public.contract_services where organization_id=public.current_organization_id() and service_status is null)),
  'contractsWithoutServices',(select count(*) from public.contracts c where c.organization_id=public.current_organization_id() and c.deleted_at is null and not exists(select 1 from public.contract_services s where s.contract_id=c.id)),
  'proposalsWithoutServices',(select count(*) from public.proposals p where p.organization_id=public.current_organization_id() and p.deleted_at is null and not exists(select 1 from public.proposal_services s where s.proposal_id=p.id))
) else null end $$;
grant execute on function public.service_responsibility_diagnostic() to authenticated;
