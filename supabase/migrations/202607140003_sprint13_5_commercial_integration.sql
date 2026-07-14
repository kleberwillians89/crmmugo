-- Integração transacional entre propostas, contratos, serviços e financeiro.
create extension if not exists unaccent;
alter table public.contracts add column if not exists activated_at timestamptz;
alter table public.invoice_installments
  add column if not exists proposal_id uuid references public.proposals(id) on delete set null,
  add column if not exists installment_type text not null default 'monthly',
  add column if not exists description text,
  add column if not exists source text not null default 'contract';
alter table public.invoice_installments drop constraint if exists invoice_installments_type_check;
alter table public.invoice_installments add constraint invoice_installments_type_check check(installment_type in('setup','monthly'));

alter table public.proposal_services add column if not exists setup_value numeric(14,2) not null default 0,add column if not exists discount numeric(14,2) not null default 0,add column if not exists total_value numeric(14,2);
alter table public.contract_services add column if not exists setup_value numeric(14,2) not null default 0,add column if not exists discount numeric(14,2) not null default 0,add column if not exists total_value numeric(14,2);
alter table public.proposal_services drop constraint if exists proposal_services_discount_nonnegative;
alter table public.proposal_services add constraint proposal_services_discount_nonnegative check(discount>=0);
alter table public.contract_services drop constraint if exists contract_services_discount_nonnegative;
alter table public.contract_services add constraint contract_services_discount_nonnegative check(discount>=0);

create table if not exists public.invoice_installment_allocations(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
  installment_id uuid not null references public.invoice_installments(id) on delete cascade,
  contract_service_id uuid not null references public.contract_services(id) on delete restrict,
  amount numeric(14,2) not null check(amount>=0),percentage numeric(7,4) not null check(percentage>=0 and percentage<=100),created_at timestamptz not null default now(),
  unique(installment_id,contract_service_id)
);
alter table public.invoice_installment_allocations enable row level security;
drop policy if exists invoice_installment_allocations_read on public.invoice_installment_allocations;
create policy invoice_installment_allocations_read on public.invoice_installment_allocations for select to authenticated using(organization_id=public.current_organization_id() and public.is_active_user());
drop policy if exists invoice_installment_allocations_write on public.invoice_installment_allocations;
create policy invoice_installment_allocations_write on public.invoice_installment_allocations for all to authenticated using(organization_id=public.current_organization_id() and public.can_write()) with check(organization_id=public.current_organization_id() and public.can_write());
create index if not exists installment_allocations_service_idx on public.invoice_installment_allocations(organization_id,contract_service_id);

drop index if exists public.invoice_installments_contract_competence_unique;
alter table public.invoice_installments drop constraint if exists invoice_installments_organization_id_contract_id_reference_month_installment_number_key;
create unique index if not exists invoice_installments_contract_type_competence_unique on public.invoice_installments(organization_id,contract_id,installment_type,reference_month);

create or replace function public.link_proposal_to_contract(proposal_id uuid,contract_id uuid) returns public.contracts language plpgsql security definer set search_path='' as $$
declare p public.proposals%rowtype;c public.contracts%rowtype;conflict_number text;
begin
  if public.current_user_role() not in('admin','manager') then raise exception 'Você não tem permissão para vincular registros.';end if;
  select * into p from public.proposals p0 where p0.id=$1 and p0.organization_id=public.current_organization_id() and p0.deleted_at is null for update;
  select * into c from public.contracts c0 where c0.id=$2 and c0.organization_id=public.current_organization_id() and c0.deleted_at is null for update;
  if p.id is null or c.id is null then raise exception 'Proposta ou contrato não encontrado.';end if;
  if p.client_id<>c.client_id then raise exception 'A proposta e o contrato pertencem a clientes diferentes.';end if;
  select c0.contract_number into conflict_number from public.contracts c0 where c0.proposal_id=p.id and c0.id<>c.id and c0.deleted_at is null limit 1;
  if found then raise exception 'A proposta já está vinculada ao contrato %.',coalesce(conflict_number,'sem número');end if;
  if c.proposal_id is not null and c.proposal_id<>p.id then raise exception 'Este contrato já possui outra proposta vinculada.';end if;
  update public.contracts set proposal_id=p.id,updated_by=auth.uid(),updated_at=now() where id=c.id returning * into c;
  insert into public.commercial_events(organization_id,client_id,proposal_id,contract_id,event_type,title,new_value,created_by) values(c.organization_id,c.client_id,p.id,c.id,'proposal_contract_linked','Proposta vinculada ao contrato',jsonb_build_object('proposal_id',p.id,'contract_id',c.id),auth.uid());
  return c;
end$$;

create or replace function public.unlink_proposal_from_contract(proposal_id uuid,contract_id uuid) returns public.contracts language plpgsql security definer set search_path='' as $$
declare c public.contracts%rowtype;
begin
  if public.current_user_role() not in('admin','manager') then raise exception 'Você não tem permissão para desvincular registros.';end if;
  select * into c from public.contracts c0 where c0.id=$2 and c0.proposal_id=$1 and c0.organization_id=public.current_organization_id() and c0.deleted_at is null for update;
  if c.id is null then raise exception 'O vínculo informado não existe.';end if;
  update public.contracts set proposal_id=null,updated_by=auth.uid(),updated_at=now() where id=c.id returning * into c;
  insert into public.commercial_events(organization_id,client_id,proposal_id,contract_id,event_type,title,old_value,created_by) values(c.organization_id,c.client_id,proposal_id,c.id,'proposal_contract_unlinked','Proposta desvinculada do contrato',jsonb_build_object('proposal_id',proposal_id,'contract_id',c.id),auth.uid());
  return c;
end$$;

create or replace function public.create_contract_from_proposal(target_proposal_id uuid) returns public.contracts language plpgsql security definer set search_path='' as $$
declare p public.proposals%rowtype;c public.contracts%rowtype;
begin
  if public.current_user_role() not in('admin','manager') then raise exception 'Você não tem permissão para converter propostas.';end if;
  select * into p from public.proposals where id=target_proposal_id and organization_id=public.current_organization_id() and deleted_at is null for update;
  if p.id is null then raise exception 'Proposta não encontrada.';end if;
  if exists(select 1 from public.contracts where proposal_id=p.id and deleted_at is null) then raise exception 'Esta proposta já possui contrato.';end if;
  insert into public.contracts(organization_id,client_id,proposal_id,status,signed,minimum_term_months,setup_value,monthly_value,total_value,notes,responsible_id,created_by)
  values(p.organization_id,p.client_id,p.id,'draft',false,p.contract_term_months,p.setup_value,p.monthly_value,p.total_value,p.notes,p.responsible_id,auth.uid()) returning * into c;
  insert into public.contract_services(organization_id,contract_id,service_catalog_id,service_name,service_category,billing_type,quantity,unit_price,monthly_value,one_time_value,setup_value,discount,total_value,duration_months,service_status,commercial_responsible_id,delivery_responsible_id,support_responsible_id,scope_summary,deliverables,commercial_notes,operational_notes)
  select organization_id,c.id,service_catalog_id,service_name,service_category,billing_type,quantity,unit_price,monthly_value,one_time_value,setup_value,discount,total_value,duration_months,case when service_status='active' then 'approved' else service_status end,commercial_responsible_id,delivery_responsible_id,support_responsible_id,scope_summary,deliverables,commercial_notes,operational_notes from public.proposal_services where proposal_id=p.id;
  insert into public.commercial_events(organization_id,client_id,proposal_id,contract_id,event_type,title,new_value,created_by) values(c.organization_id,c.client_id,p.id,c.id,'proposal_converted_to_contract','Proposta convertida em contrato',jsonb_build_object('contract_id',c.id),auth.uid());
  return c;
end$$;

create or replace function public.get_contract_billing_preview(target_contract_id uuid,include_historical_periods boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.contracts%rowtype;first_month date;months integer;eligible integer;overdue_count integer;first_comp date;last_comp date;
begin
  select * into c from public.contracts where id=target_contract_id and organization_id=public.current_organization_id() and deleted_at is null;
  if c.id is null then raise exception 'Contrato não encontrado.';end if;
  if c.client_id is null then raise exception 'Informe o cliente do contrato.';end if;
  if coalesce(c.monthly_value,0)<=0 then raise exception 'Informe uma mensalidade maior que zero.';end if;
  if c.start_date is null or c.billing_day is null then raise exception 'Informe a data inicial e o dia de cobrança.';end if;
  if coalesce(c.minimum_term_months,0)<=0 and c.end_date is null then raise exception 'Informe o prazo mínimo ou a data final.';end if;
  first_month:=date_trunc('month',c.start_date)::date;
  months:=case when coalesce(c.minimum_term_months,0)>0 then c.minimum_term_months else greatest(1,(extract(year from age(c.end_date,c.start_date))*12+extract(month from age(c.end_date,c.start_date)))::integer+1) end;
  select count(*),count(*) filter(where due_date<current_date),min(competence),max(competence) into eligible,overdue_count,first_comp,last_comp from(select competence,make_date(extract(year from competence)::int,extract(month from competence)::int,least(c.billing_day,extract(day from(date_trunc('month',competence)+interval '1 month - 1 day'))::int)) due_date from(select(first_month+(n||' months')::interval)::date competence from generate_series(0,months-1)n)s where include_historical_periods or competence>=date_trunc('month',current_date)::date)x;
  return jsonb_build_object('contractId',c.id,'monthlyValue',c.monthly_value,'setupValue',c.setup_value,'startDate',c.start_date,'endDate',c.end_date,'termMonths',c.minimum_term_months,'billingDay',c.billing_day,'installmentCount',eligible,'firstCompetence',first_comp,'lastCompetence',last_comp,'overdueCount',overdue_count,'futureCount',eligible-overdue_count,'totalExpected',eligible*c.monthly_value+coalesce(c.setup_value,0),'alreadyActive',c.status='active','hasHistorical',first_month<date_trunc('month',current_date)::date);
end$$;

create or replace function public.activate_contract_and_generate_installments(target_contract_id uuid,include_historical_periods boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.contracts%rowtype;preview jsonb;first_month date;months integer;created_monthly integer:=0;created_setup integer:=0;allocation_count integer:=0;
begin
  if public.current_user_role() not in('admin','manager') then raise exception 'Você não tem permissão para ativar contratos.';end if;
  preview:=public.get_contract_billing_preview(target_contract_id,include_historical_periods);
  select * into c from public.contracts where id=target_contract_id and organization_id=public.current_organization_id() for update;
  first_month:=date_trunc('month',c.start_date)::date;
  months:=case when coalesce(c.minimum_term_months,0)>0 then c.minimum_term_months else greatest(1,(extract(year from age(c.end_date,c.start_date))*12+extract(month from age(c.end_date,c.start_date)))::integer+1) end;
  if coalesce(c.setup_value,0)>0 then
    insert into public.invoice_installments(organization_id,client_id,contract_id,proposal_id,reference_month,installment_number,due_date,amount,received_amount,status,provider,idempotency_key,installment_type,description,source)
    values(c.organization_id,c.client_id,c.id,c.proposal_id,first_month,1,c.start_date,c.setup_value,0,case when c.start_date<current_date then 'overdue' else 'pending' end,'manual',c.organization_id||':'||c.id||':setup', 'setup','Setup / implantação','contract') on conflict(organization_id,contract_id,installment_type,reference_month) do nothing;
    get diagnostics created_setup=row_count;
  end if;
  insert into public.invoice_installments(organization_id,client_id,contract_id,proposal_id,reference_month,installment_number,due_date,amount,received_amount,status,provider,idempotency_key,installment_type,description,source)
  select c.organization_id,c.client_id,c.id,c.proposal_id,competence,n+1,due_date,c.monthly_value,0,case when due_date<current_date then 'overdue' else 'pending' end,'manual',c.organization_id||':'||c.id||':monthly:'||competence,'monthly','Mensalidade '||to_char(competence,'MM/YYYY'),'contract'
  from(select n,competence,make_date(extract(year from competence)::int,extract(month from competence)::int,least(c.billing_day,extract(day from(date_trunc('month',competence)+interval '1 month - 1 day'))::int)) due_date from(select n,(first_month+(n||' months')::interval)::date competence from generate_series(0,months-1)n)s)x
  where include_historical_periods or competence>=date_trunc('month',current_date)::date on conflict(organization_id,contract_id,installment_type,reference_month) do nothing;
  get diagnostics created_monthly=row_count;
  insert into public.invoice_installment_allocations(organization_id,installment_id,contract_service_id,amount,percentage)
  select i.organization_id,i.id,s.id,round(i.amount*(case when i.installment_type='setup' then coalesce(nullif(s.setup_value,0),s.one_time_value,0) else coalesce(s.monthly_value,0) end)/tot.total,2),round(100*(case when i.installment_type='setup' then coalesce(nullif(s.setup_value,0),s.one_time_value,0) else coalesce(s.monthly_value,0) end)/tot.total,4)
  from public.invoice_installments i join public.contract_services s on s.contract_id=i.contract_id cross join lateral(select sum(case when i.installment_type='setup' then coalesce(nullif(x.setup_value,0),x.one_time_value,0) else coalesce(x.monthly_value,0) end) total from public.contract_services x where x.contract_id=i.contract_id)tot
  where i.contract_id=c.id and tot.total>0 and(case when i.installment_type='setup' then coalesce(nullif(s.setup_value,0),s.one_time_value,0) else coalesce(s.monthly_value,0) end)>0 on conflict(installment_id,contract_service_id) do nothing;
  get diagnostics allocation_count=row_count;
  with totals as(select a.installment_id,sum(a.amount) allocated,max(a.id::text)::uuid adjustment_id from public.invoice_installment_allocations a join public.invoice_installments i on i.id=a.installment_id where i.contract_id=c.id group by a.installment_id)
  update public.invoice_installment_allocations a set amount=a.amount+(i.amount-t.allocated) from totals t join public.invoice_installments i on i.id=t.installment_id where a.id=t.adjustment_id and t.allocated<>i.amount;
  update public.contracts set status='active',activated_at=coalesce(activated_at,now()),updated_by=auth.uid(),updated_at=now() where id=c.id;
  insert into public.commercial_events(organization_id,client_id,proposal_id,contract_id,event_type,title,new_value,created_by) values(c.organization_id,c.client_id,c.proposal_id,c.id,case when c.status='active' then 'contract_missing_installments_generated' else 'contract_activated' end,case when c.status='active' then 'Competências faltantes geradas' else 'Contrato ativado e cobranças geradas' end,jsonb_build_object('monthly_created',created_monthly,'setup_created',created_setup,'allocations_created',allocation_count,'include_historical',include_historical_periods,'preview',preview),auth.uid());
  return preview||jsonb_build_object('created',created_monthly+created_setup,'monthlyCreated',created_monthly,'setupCreated',created_setup,'allocationsCreated',allocation_count,'status','active');
end$$;

create or replace function public.find_matching_clients(cnpj text default null,cpf text default null,email text default null,company_name text default null,trade_name text default null,phone text default null) returns jsonb language sql security definer set search_path='' as $$
with input as(select regexp_replace(coalesce(cnpj,cpf,''),'\D','','g') document,lower(trim(coalesce(email,''))) email,lower(public.unaccent(trim(coalesce(company_name,'')))) company,lower(public.unaccent(trim(coalesce(trade_name,'')))) trade,regexp_replace(coalesce(phone,''),'\D','','g') phone),matches as(select c.id,c.company_name,c.trade_name,c.document_number,c.email,c.phone,case when i.document<>'' and regexp_replace(coalesce(c.document_number,''),'\D','','g')=i.document then 'exact_document' when i.email<>'' and lower(trim(coalesce(c.email,'')))=i.email then 'exact_email' when i.phone<>'' and regexp_replace(coalesce(c.phone,''),'\D','','g')=i.phone then 'probable_phone' when i.company<>'' and lower(public.unaccent(trim(c.company_name)))=i.company then 'probable_company' when i.trade<>'' and lower(public.unaccent(trim(coalesce(c.trade_name,''))))=i.trade then 'probable_trade_name' end match_type from public.clients c cross join input i where c.organization_id=public.current_organization_id() and c.deleted_at is null)
select coalesce(jsonb_agg(to_jsonb(matches)) filter(where match_type is not null),'[]'::jsonb) from matches where match_type is not null $$;

revoke all on function public.link_proposal_to_contract(uuid,uuid),public.unlink_proposal_from_contract(uuid,uuid),public.create_contract_from_proposal(uuid),public.get_contract_billing_preview(uuid,boolean),public.activate_contract_and_generate_installments(uuid,boolean),public.find_matching_clients(text,text,text,text,text,text) from public;
grant execute on function public.link_proposal_to_contract(uuid,uuid),public.unlink_proposal_from_contract(uuid,uuid),public.create_contract_from_proposal(uuid),public.get_contract_billing_preview(uuid,boolean),public.activate_contract_and_generate_installments(uuid,boolean),public.find_matching_clients(text,text,text,text,text,text) to authenticated;
