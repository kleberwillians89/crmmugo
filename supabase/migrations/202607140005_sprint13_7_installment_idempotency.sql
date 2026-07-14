-- Sprint 13.7: geração incremental compatível com todas as constraints únicas existentes.
-- Nenhuma constraint é removida ou alterada nesta migration.

create or replace function public.get_contract_billing_preview(target_contract_id uuid,include_historical_periods boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.contracts%rowtype;first_month date;months integer;setup_exists boolean;existing_competences jsonb;new_competences jsonb;existing_count integer;new_count integer;overdue_count integer;first_comp date;last_comp date;
begin
  select * into c from public.contracts where id=target_contract_id and organization_id=public.current_organization_id() and deleted_at is null;
  if c.id is null then raise exception 'Contrato não encontrado.';end if;
  if c.client_id is null then raise exception 'Informe o cliente do contrato.';end if;
  if coalesce(c.monthly_value,0)<=0 then raise exception 'Informe uma mensalidade maior que zero.';end if;
  if c.start_date is null or c.billing_day is null then raise exception 'Informe a data inicial e o dia de cobrança.';end if;
  if coalesce(c.minimum_term_months,0)<=0 and c.end_date is null then raise exception 'Informe o prazo mínimo ou a data final.';end if;
  first_month:=date_trunc('month',c.start_date)::date;
  months:=case when coalesce(c.minimum_term_months,0)>0 then c.minimum_term_months else greatest(1,(extract(year from age(c.end_date,c.start_date))*12+extract(month from age(c.end_date,c.start_date)))::integer+1) end;
  setup_exists:=exists(select 1 from public.invoice_installments i where i.contract_id=c.id and(i.installment_type='setup' or i.idempotency_key=c.organization_id||':'||c.id||':setup'));
  with schedule as(
    select competence,make_date(extract(year from competence)::int,extract(month from competence)::int,least(c.billing_day,extract(day from(date_trunc('month',competence)+interval '1 month - 1 day'))::int)) due_date
    from(select(first_month+(n||' months')::interval)::date competence from generate_series(0,months-1)n)s
    where include_historical_periods or competence>=date_trunc('month',current_date)::date
  ),classified as(
    select s.*,exists(select 1 from public.invoice_installments i where i.contract_id=c.id and date_trunc('month',i.reference_month)::date=s.competence and coalesce(i.installment_type,'monthly')='monthly') already_exists from schedule s
  )
  select coalesce(jsonb_agg(to_char(competence,'YYYY-MM')) filter(where already_exists),'[]'::jsonb),coalesce(jsonb_agg(to_char(competence,'YYYY-MM')) filter(where not already_exists),'[]'::jsonb),count(*) filter(where already_exists),count(*) filter(where not already_exists),count(*) filter(where not already_exists and due_date<current_date),min(competence) filter(where not already_exists),max(competence) filter(where not already_exists)
  into existing_competences,new_competences,existing_count,new_count,overdue_count,first_comp,last_comp from classified;
  return jsonb_build_object(
    'contractId',c.id,'monthlyValue',c.monthly_value,'setupValue',c.setup_value,'setupExists',setup_exists,'setupWillBeCreated',coalesce(c.setup_value,0)>0 and not setup_exists,
    'startDate',c.start_date,'endDate',c.end_date,'termMonths',c.minimum_term_months,'billingDay',c.billing_day,
    'existingCompetences',existing_competences,'newCompetences',new_competences,'existingCount',existing_count,'installmentCount',new_count,
    'firstCompetence',first_comp,'lastCompetence',last_comp,'overdueCount',overdue_count,'futureCount',new_count-overdue_count,
    'totalExpected',new_count*c.monthly_value+case when coalesce(c.setup_value,0)>0 and not setup_exists then c.setup_value else 0 end,
    'alreadyActive',c.status='active','hasHistorical',first_month<date_trunc('month',current_date)::date,
    'message',case when new_count=0 and(setup_exists or coalesce(c.setup_value,0)=0) then 'Nenhuma competência pendente.' else new_count||' competência(s) pendente(s).' end
  );
end$$;

create or replace function public.activate_contract_and_generate_installments(target_contract_id uuid,include_historical_periods boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.contracts%rowtype;preview jsonb;first_month date;setup_reference date;months integer;created_monthly integer:=0;created_setup integer:=0;allocation_count integer:=0;
begin
  if public.current_user_role() not in('admin','manager') then raise exception 'Você não tem permissão para ativar contratos.';end if;
  preview:=public.get_contract_billing_preview(target_contract_id,include_historical_periods);
  select * into c from public.contracts where id=target_contract_id and organization_id=public.current_organization_id() and deleted_at is null for update;
  if c.id is null then raise exception 'Contrato não encontrado.';end if;
  first_month:=date_trunc('month',c.start_date)::date;
  -- Setup não é competência mensal. O último dia do mês evita colisão com a competência mensal (sempre dia 1) em constraints legadas.
  setup_reference:=(date_trunc('month',c.start_date)+interval '1 month - 1 day')::date;
  months:=case when coalesce(c.minimum_term_months,0)>0 then c.minimum_term_months else greatest(1,(extract(year from age(c.end_date,c.start_date))*12+extract(month from age(c.end_date,c.start_date)))::integer+1) end;

  if coalesce(c.setup_value,0)>0 and not exists(select 1 from public.invoice_installments i where i.contract_id=c.id and(i.installment_type='setup' or i.idempotency_key=c.organization_id||':'||c.id||':setup')) then
    insert into public.invoice_installments(organization_id,client_id,contract_id,proposal_id,reference_month,installment_number,due_date,amount,received_amount,status,provider,idempotency_key,installment_type,description,source)
    values(c.organization_id,c.client_id,c.id,c.proposal_id,setup_reference,1,c.start_date,c.setup_value,0,case when c.start_date<current_date then 'overdue' else 'pending' end,'manual',c.organization_id||':'||c.id||':setup','setup','Setup / implantação','contract')
    on conflict do nothing;
    get diagnostics created_setup=row_count;
  end if;

  insert into public.invoice_installments(organization_id,client_id,contract_id,proposal_id,reference_month,installment_number,due_date,amount,received_amount,status,provider,idempotency_key,installment_type,description,source)
  select c.organization_id,c.client_id,c.id,c.proposal_id,competence,n+1,due_date,c.monthly_value,0,case when due_date<current_date then 'overdue' else 'pending' end,'manual',c.organization_id||':'||c.id||':monthly:'||competence,'monthly','Mensalidade '||to_char(competence,'MM/YYYY'),'contract'
  from(
    select n,competence,make_date(extract(year from competence)::int,extract(month from competence)::int,least(c.billing_day,extract(day from(date_trunc('month',competence)+interval '1 month - 1 day'))::int)) due_date
    from(select n,(first_month+(n||' months')::interval)::date competence from generate_series(0,months-1)n)s
  )x
  where(include_historical_periods or competence>=date_trunc('month',current_date)::date)
    and not exists(select 1 from public.invoice_installments i where i.contract_id=c.id and date_trunc('month',i.reference_month)::date=competence and coalesce(i.installment_type,'monthly')='monthly')
  on conflict do nothing;
  get diagnostics created_monthly=row_count;

  insert into public.invoice_installment_allocations(organization_id,installment_id,contract_service_id,amount,percentage)
  select i.organization_id,i.id,s.id,round(i.amount*(case when i.installment_type='setup' then coalesce(nullif(s.setup_value,0),s.one_time_value,0) else coalesce(s.monthly_value,0) end)/tot.total,2),round(100*(case when i.installment_type='setup' then coalesce(nullif(s.setup_value,0),s.one_time_value,0) else coalesce(s.monthly_value,0) end)/tot.total,4)
  from public.invoice_installments i join public.contract_services s on s.contract_id=i.contract_id
  cross join lateral(select sum(case when i.installment_type='setup' then coalesce(nullif(x.setup_value,0),x.one_time_value,0) else coalesce(x.monthly_value,0) end) total from public.contract_services x where x.contract_id=i.contract_id)tot
  where i.contract_id=c.id and tot.total>0 and(case when i.installment_type='setup' then coalesce(nullif(s.setup_value,0),s.one_time_value,0) else coalesce(s.monthly_value,0) end)>0
  on conflict do nothing;
  get diagnostics allocation_count=row_count;

  with totals as(select a.installment_id,sum(a.amount) allocated,max(a.id::text)::uuid adjustment_id from public.invoice_installment_allocations a join public.invoice_installments i on i.id=a.installment_id where i.contract_id=c.id group by a.installment_id)
  update public.invoice_installment_allocations a set amount=a.amount+(i.amount-t.allocated) from totals t join public.invoice_installments i on i.id=t.installment_id where a.id=t.adjustment_id and t.allocated<>i.amount;

  update public.contracts set status='active',activated_at=coalesce(activated_at,now()),updated_by=auth.uid(),updated_at=now() where id=c.id;
  insert into public.commercial_events(organization_id,client_id,proposal_id,contract_id,event_type,title,new_value,created_by)
  values(c.organization_id,c.client_id,c.proposal_id,c.id,case when c.status='active' then 'contract_missing_installments_generated' else 'contract_activated' end,case when created_monthly+created_setup=0 then 'Nenhuma competência pendente' when c.status='active' then 'Competências faltantes geradas' else 'Contrato ativado e cobranças geradas' end,jsonb_build_object('monthly_created',created_monthly,'setup_created',created_setup,'allocations_created',allocation_count,'include_historical',include_historical_periods,'preview',preview),auth.uid());
  return preview||jsonb_build_object('created',created_monthly+created_setup,'monthlyCreated',created_monthly,'setupCreated',created_setup,'allocationsCreated',allocation_count,'status','active','message',case when created_monthly+created_setup=0 then 'Nenhuma competência pendente.' else(created_monthly+created_setup)||' cobrança(s) criada(s).' end);
end$$;

revoke all on function public.get_contract_billing_preview(uuid,boolean),public.activate_contract_and_generate_installments(uuid,boolean) from public;
grant execute on function public.get_contract_billing_preview(uuid,boolean),public.activate_contract_and_generate_installments(uuid,boolean) to authenticated;

