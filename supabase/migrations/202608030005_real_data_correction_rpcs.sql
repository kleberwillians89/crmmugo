-- Correções reais assistidas. Esta migration cria apenas funções e permissões.
-- Nenhum dado de negócio é inserido ou atualizado durante sua aplicação.

create or replace function public.apply_contract_future_change(
  p_contract_id uuid,
  p_effective_month date,
  p_new_monthly_value numeric default null,
  p_new_billing_day integer default null,
  p_reason text default null,
  p_request_key text default null
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_org uuid:=public.current_organization_id();v_contract public.contracts%rowtype;v_after public.contracts%rowtype;
  v_existing jsonb;v_before_installments jsonb;v_after_installments jsonb;v_ids uuid[]:=array[]::uuid[];v_result jsonb;
begin
  if auth.uid() is null or v_org is null then raise exception 'Usuário autenticado obrigatório.';end if;
  if not public.can_write() then raise exception 'Você não tem permissão para corrigir contratos.';end if;
  if nullif(trim(p_request_key),'') is null then raise exception 'request_key obrigatório.';end if;
  if p_effective_month is null or p_effective_month<>date_trunc('month',p_effective_month)::date then raise exception 'A competência inicial deve ser o primeiro dia do mês.';end if;
  if p_new_monthly_value is null and p_new_billing_day is null then raise exception 'Informe valor mensal ou dia de vencimento.';end if;
  if p_new_monthly_value is not null and p_new_monthly_value<=0 then raise exception 'O valor mensal deve ser positivo.';end if;
  if p_new_billing_day is not null and p_new_billing_day not between 1 and 31 then raise exception 'O dia de vencimento deve estar entre 1 e 31.';end if;
  if length(trim(coalesce(p_reason,'')))<10 then raise exception 'Informe um motivo com pelo menos 10 caracteres.';end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text||':contract-future:'||p_request_key,0));
  select new_value->'result' into v_existing from public.commercial_events where organization_id=v_org and event_type='contract_future_change' and new_value->>'request_key'=p_request_key order by created_at desc limit 1;
  if v_existing is not null then return v_existing||jsonb_build_object('idempotentReplay',true);end if;
  select * into v_contract from public.contracts where id=p_contract_id and organization_id=v_org and deleted_at is null for update;
  if not found then raise exception 'Contrato não encontrado nesta organização.';end if;
  select coalesce(array_agg(i.id order by i.id),array[]::uuid[]),coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb)
    into v_ids,v_before_installments from public.invoice_installments i
   where i.organization_id=v_org and i.contract_id=v_contract.id
     and date_trunc('month',i.reference_month)::date>=p_effective_month
     and i.status in('pending','overdue') and coalesce(i.received_amount,0)=0 and i.paid_at is null
     and coalesce(i.installment_type,'monthly')<>'setup' and coalesce(i.idempotency_key,'') not like '%:setup';
  update public.contracts set monthly_value=coalesce(p_new_monthly_value,monthly_value),billing_day=coalesce(p_new_billing_day,billing_day),updated_by=auth.uid(),updated_at=now() where id=v_contract.id returning * into v_after;
  if cardinality(v_ids)>0 then
    update public.invoice_installments i set
      amount=coalesce(p_new_monthly_value,i.amount),
      due_date=case when p_new_billing_day is null then i.due_date else make_date(extract(year from i.reference_month)::int,extract(month from i.reference_month)::int,least(p_new_billing_day,extract(day from(date_trunc('month',i.reference_month)+interval '1 month - 1 day'))::int)) end,
      updated_at=now()
    where i.id=any(v_ids) and i.organization_id=v_org and i.status in('pending','overdue')
      and coalesce(i.received_amount,0)=0 and i.paid_at is null and coalesce(i.installment_type,'monthly')<>'setup' and coalesce(i.idempotency_key,'') not like '%:setup';
  end if;
  select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb) into v_after_installments from public.invoice_installments i where i.id=any(v_ids);
  v_result:=jsonb_build_object('operation','apply_contract_future_change','requestKey',p_request_key,'organizationId',v_org,'contractId',v_contract.id,'effectiveMonth',p_effective_month,'contractBefore',to_jsonb(v_contract),'contractAfter',to_jsonb(v_after),'installmentsBefore',v_before_installments,'installmentsAfter',v_after_installments,'affectedInstallmentIds',to_jsonb(v_ids),'affectedCount',cardinality(v_ids),'paidInstallmentsChanged',0,'setupInstallmentsChanged',0,'idempotentReplay',false);
  insert into public.commercial_events(organization_id,client_id,contract_id,event_type,title,description,old_value,new_value,created_by)
  values(v_org,v_contract.client_id,v_contract.id,'contract_future_change','Mudança contratual prospectiva aplicada',trim(p_reason),jsonb_build_object('contract',to_jsonb(v_contract),'installments',v_before_installments),jsonb_build_object('request_key',p_request_key,'contract',to_jsonb(v_after),'installments',v_after_installments,'result',v_result),auth.uid());
  return v_result;
end$$;

create or replace function public.create_prospective_contract(
  p_client_id uuid,
  p_start_date date,
  p_monthly_value numeric,
  p_billing_day integer,
  p_service_name text,
  p_reason text,
  p_request_key text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_org uuid:=public.current_organization_id();v_client public.clients%rowtype;v_contract public.contracts%rowtype;v_service public.contract_services%rowtype;v_installment public.invoice_installments%rowtype;
  v_existing jsonb;v_competence date;v_due date;v_result jsonb;
begin
  if auth.uid() is null or v_org is null then raise exception 'Usuário autenticado obrigatório.';end if;
  if not public.can_write() then raise exception 'Você não tem permissão para criar contratos.';end if;
  if nullif(trim(p_request_key),'') is null then raise exception 'request_key obrigatório.';end if;
  if p_start_date is null or p_start_date<current_date then raise exception 'A data inicial deve ser atual ou futura.';end if;
  if p_monthly_value is null or p_monthly_value<=0 then raise exception 'Valor mensal positivo obrigatório.';end if;
  if p_billing_day is null or p_billing_day not between 1 and 31 then raise exception 'Dia de vencimento entre 1 e 31 obrigatório.';end if;
  if nullif(trim(p_service_name),'') is null then raise exception 'Serviço obrigatório.';end if;
  if length(trim(coalesce(p_reason,'')))<10 then raise exception 'Informe um motivo com pelo menos 10 caracteres.';end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text||':prospective-contract:'||p_request_key,0));
  select new_value->'result' into v_existing from public.commercial_events where organization_id=v_org and event_type='prospective_contract_created' and new_value->>'request_key'=p_request_key order by created_at desc limit 1;
  if v_existing is not null then return v_existing||jsonb_build_object('idempotentReplay',true);end if;
  select * into v_client from public.clients where id=p_client_id and organization_id=v_org and deleted_at is null for update;
  if not found then raise exception 'Cliente não encontrado nesta organização.';end if;
  if exists(select 1 from public.contracts c join public.contract_services s on s.contract_id=c.id and s.organization_id=v_org where c.organization_id=v_org and c.client_id=v_client.id and c.deleted_at is null and c.status='active' and c.start_date=p_start_date and c.monthly_value=p_monthly_value and c.billing_day=p_billing_day and public.accounting_normalize_name(s.service_name)=public.accounting_normalize_name(p_service_name)) then raise exception 'Já existe contrato equivalente para este cliente.';end if;
  insert into public.contracts(organization_id,client_id,status,signed,start_date,billing_day,monthly_value,setup_value,auto_renew,notes,created_by,updated_by)
  values(v_org,v_client.id,'active',false,p_start_date,p_billing_day,p_monthly_value,0,false,'Contrato prospectivo criado por fluxo assistido: '||trim(p_reason),auth.uid(),auth.uid()) returning * into v_contract;
  insert into public.contract_services(organization_id,contract_id,service_name,billing_type,quantity,unit_price,monthly_value,one_time_value)
  values(v_org,v_contract.id,trim(p_service_name),'monthly',1,p_monthly_value,p_monthly_value,0) returning * into v_service;
  v_competence:=date_trunc('month',p_start_date)::date;
  v_due:=make_date(extract(year from v_competence)::int,extract(month from v_competence)::int,least(p_billing_day,extract(day from(v_competence+interval '1 month - 1 day'))::int));
  if v_due<p_start_date or v_due<current_date then v_competence:=(v_competence+interval '1 month')::date;v_due:=make_date(extract(year from v_competence)::int,extract(month from v_competence)::int,least(p_billing_day,extract(day from(v_competence+interval '1 month - 1 day'))::int));end if;
  insert into public.invoice_installments(organization_id,client_id,contract_id,reference_month,installment_number,due_date,amount,received_amount,status,provider,idempotency_key,installment_type,description,source)
  values(v_org,v_client.id,v_contract.id,v_competence,1,v_due,p_monthly_value,0,'pending','manual',v_org||':'||v_contract.id||':monthly:'||v_competence,'monthly','Mensalidade '||to_char(v_competence,'MM/YYYY'),'contract') returning * into v_installment;
  v_result:=jsonb_build_object('operation','create_prospective_contract','requestKey',p_request_key,'organizationId',v_org,'client',to_jsonb(v_client),'contractAfter',to_jsonb(v_contract),'serviceAfter',to_jsonb(v_service),'installmentsAfter',jsonb_build_array(to_jsonb(v_installment)),'createdInstallmentIds',jsonb_build_array(v_installment.id),'createdCount',1,'retroactiveCount',0,'idempotentReplay',false);
  insert into public.commercial_events(organization_id,client_id,contract_id,event_type,title,description,old_value,new_value,created_by)
  values(v_org,v_client.id,v_contract.id,'prospective_contract_created','Contrato prospectivo criado',trim(p_reason),jsonb_build_object('client',to_jsonb(v_client),'matchingContract',null),jsonb_build_object('request_key',p_request_key,'contract',to_jsonb(v_contract),'service',to_jsonb(v_service),'installment',to_jsonb(v_installment),'result',v_result),auth.uid());
  return v_result;
end$$;

create or replace function public.mark_contract_ended(
  p_contract_id uuid,
  p_end_date date,
  p_reason text,
  p_request_key text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_org uuid:=public.current_organization_id();v_before public.contracts%rowtype;v_after public.contracts%rowtype;v_existing jsonb;v_installments jsonb;v_result jsonb;
begin
  if auth.uid() is null or v_org is null then raise exception 'Usuário autenticado obrigatório.';end if;
  if not public.can_write() then raise exception 'Você não tem permissão para encerrar contratos.';end if;
  if nullif(trim(p_request_key),'') is null then raise exception 'request_key obrigatório.';end if;
  if p_end_date is null then raise exception 'Data de encerramento obrigatória.';end if;
  if length(trim(coalesce(p_reason,'')))<10 then raise exception 'Informe um motivo com pelo menos 10 caracteres.';end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text||':contract-ended:'||p_request_key,0));
  select new_value->'result' into v_existing from public.commercial_events where organization_id=v_org and event_type='contract_ended_assisted' and new_value->>'request_key'=p_request_key order by created_at desc limit 1;
  if v_existing is not null then return v_existing||jsonb_build_object('idempotentReplay',true);end if;
  select * into v_before from public.contracts where id=p_contract_id and organization_id=v_org and deleted_at is null for update;
  if not found then raise exception 'Contrato não encontrado nesta organização.';end if;
  if p_end_date<v_before.start_date then raise exception 'A data final não pode ser anterior ao início.';end if;
  select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb) into v_installments from public.invoice_installments i where i.organization_id=v_org and i.contract_id=v_before.id;
  update public.contracts set status='terminated',end_date=p_end_date,termination_date=p_end_date,termination_reason=trim(p_reason),updated_by=auth.uid(),updated_at=now() where id=v_before.id returning * into v_after;
  v_result:=jsonb_build_object('operation','mark_contract_ended','requestKey',p_request_key,'organizationId',v_org,'contractBefore',to_jsonb(v_before),'contractAfter',to_jsonb(v_after),'installmentsPreserved',v_installments,'installmentsChanged',0,'paymentsChanged',0,'idempotentReplay',false);
  insert into public.commercial_events(organization_id,client_id,contract_id,event_type,title,description,old_value,new_value,created_by)
  values(v_org,v_before.client_id,v_before.id,'contract_ended_assisted','Contrato encerrado por fluxo assistido',trim(p_reason),jsonb_build_object('contract',to_jsonb(v_before),'installments',v_installments),jsonb_build_object('request_key',p_request_key,'contract',to_jsonb(v_after),'installments',v_installments,'result',v_result),auth.uid());
  return v_result;
end$$;

create or replace function public.validate_real_data_correction(p_request_key text)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_org uuid:=public.current_organization_id();v_event public.commercial_events%rowtype;v_merge public.data_merge_batches%rowtype;v_result jsonb;v_inconsistencies jsonb:='[]'::jsonb;
begin
  if auth.uid() is null or v_org is null then raise exception 'Usuário autenticado obrigatório.';end if;
  if not public.can_write() then raise exception 'Você não tem permissão para validar correções.';end if;
  if nullif(trim(p_request_key),'') is null then raise exception 'request_key obrigatório.';end if;
  select * into v_event from public.commercial_events where organization_id=v_org and new_value->>'request_key'=p_request_key and event_type in('contract_future_change','prospective_contract_created','contract_ended_assisted') order by created_at desc limit 1;
  if found then
    v_result:=v_event.new_value->'result';
    return jsonb_build_object('operation',v_result->>'operation','requestKey',p_request_key,'contractBefore',coalesce(v_result->'contractBefore',v_event.old_value->'contract'),'contractAfter',coalesce(v_result->'contractAfter',v_event.new_value->'contract'),'paidInstallmentsPreserved',coalesce((v_result->>'paidInstallmentsChanged')::int,0)=0,'futureInstallmentsChanged',coalesce(v_result->'affectedInstallmentIds',v_result->'createdInstallmentIds','[]'::jsonb),'primaryClient',coalesce(v_result->'client',jsonb_build_object('id',v_event.client_id)),'secondaryClientArchived',null,'auditRecords',jsonb_build_array(to_jsonb(v_event)),'inconsistencies',v_inconsistencies);
  end if;
  if p_request_key~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then select * into v_merge from public.data_merge_batches where organization_id=v_org and request_key=p_request_key::uuid limit 1;end if;
  if found then
    if not exists(select 1 from public.clients where organization_id=v_org and id=v_merge.primary_client_id) then v_inconsistencies:=v_inconsistencies||jsonb_build_array('Cliente principal não encontrado');end if;
    if exists(select 1 from public.clients where organization_id=v_org and id=any(v_merge.secondary_client_ids) and(status<>'archived' or deleted_at is null)) then v_inconsistencies:=v_inconsistencies||jsonb_build_array('Cliente secundário não está arquivado');end if;
    if exists(select 1 from public.data_merge_items d join public.invoice_installments i on i.id=d.record_id where d.batch_id=v_merge.id and d.table_name='invoice_installments' and((d.before_data->>'status'='paid' or coalesce((d.before_data->>'received_amount')::numeric,0)>0) and(i.status is distinct from d.before_data->>'status' or i.amount is distinct from(d.before_data->>'amount')::numeric or coalesce(i.received_amount,0) is distinct from coalesce((d.before_data->>'received_amount')::numeric,0)))) then v_inconsistencies:=v_inconsistencies||jsonb_build_array('Parcela paga ou recebimento foi alterado');end if;
    return jsonb_build_object('operation','execute_client_merge','requestKey',p_request_key,'contractBefore',(select coalesce(jsonb_agg(before_data),'[]'::jsonb) from public.data_merge_items where batch_id=v_merge.id and table_name='contracts'),'contractAfter',(select coalesce(jsonb_agg(after_data),'[]'::jsonb) from public.data_merge_items where batch_id=v_merge.id and table_name='contracts'),'paidInstallmentsPreserved',not(v_inconsistencies?'Parcela paga ou recebimento foi alterado'),'futureInstallmentsChanged','[]'::jsonb,'primaryClient',(select to_jsonb(c) from public.clients c where c.id=v_merge.primary_client_id),'secondaryClientArchived',not(v_inconsistencies?'Cliente secundário não está arquivado'),'auditRecords',(select coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) from public.data_merge_items d where d.batch_id=v_merge.id),'inconsistencies',v_inconsistencies);
  end if;
  raise exception 'Correção não encontrada nesta organização.';
end$$;

revoke all on function public.apply_contract_future_change(uuid,date,numeric,integer,text,text) from public;
revoke all on function public.create_prospective_contract(uuid,date,numeric,integer,text,text,text) from public;
revoke all on function public.mark_contract_ended(uuid,date,text,text) from public;
revoke all on function public.validate_real_data_correction(text) from public;
grant execute on function public.apply_contract_future_change(uuid,date,numeric,integer,text,text) to authenticated;
grant execute on function public.create_prospective_contract(uuid,date,numeric,integer,text,text,text) to authenticated;
grant execute on function public.mark_contract_ended(uuid,date,text,text) to authenticated;
grant execute on function public.validate_real_data_correction(text) to authenticated;
