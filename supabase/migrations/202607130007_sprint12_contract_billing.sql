-- Sprint 12: geração idempotente de cobranças e recebimentos exclusivamente manuais.
alter table public.invoice_installments
  add column if not exists received_amount numeric(14,2) not null default 0,
  add column if not exists payment_notes text;
alter table public.invoice_installments drop constraint if exists invoice_installments_received_amount_nonnegative;
alter table public.invoice_installments add constraint invoice_installments_received_amount_nonnegative check(received_amount>=0);
alter table public.invoice_installments drop constraint if exists invoice_installments_status_check;
alter table public.invoice_installments add constraint invoice_installments_status_check check(status in('draft','pending','partial','paid','overdue','cancelled','refunded','failed'));
create unique index if not exists invoice_installments_contract_competence_unique on public.invoice_installments(organization_id,contract_id,reference_month);
alter table public.commercial_events add column if not exists installment_id uuid references public.invoice_installments(id);

create or replace function public.preview_contract_installments(target_id uuid,include_history boolean default false,horizon integer default 3) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.contracts%rowtype;first_month date;months integer;first_due date;last_due date;eligible integer;
begin
  select * into c from public.contracts where id=target_id and organization_id=public.current_organization_id();
  if c.id is null then raise exception 'Contrato não encontrado.';end if;
  if not c.signed then raise exception 'Confirme a assinatura antes de gerar cobranças.';end if;
  if coalesce(c.monthly_value,0)<=0 then raise exception 'Informe uma mensalidade maior que zero.';end if;
  if c.start_date is null then raise exception 'Informe a data inicial do contrato.';end if;
  if c.billing_day is null then raise exception 'Informe o dia de cobrança antes de gerar cobranças.';end if;
  first_month:=date_trunc('month',c.start_date)::date;
  months:=case when coalesce(c.minimum_term_months,0)>0 then c.minimum_term_months when c.end_date is not null then greatest(1,(extract(year from age(c.end_date,c.start_date))*12+extract(month from age(c.end_date,c.start_date)))::integer) else greatest(1,least(horizon,3)) end;
  select count(*),min(make_date(extract(year from competence)::int,extract(month from competence)::int,least(c.billing_day,extract(day from (date_trunc('month',competence)+interval '1 month - 1 day'))::int))),max(make_date(extract(year from competence)::int,extract(month from competence)::int,least(c.billing_day,extract(day from (date_trunc('month',competence)+interval '1 month - 1 day'))::int))) into eligible,first_due,last_due
  from (select (first_month+(n||' months')::interval)::date competence from generate_series(0,months-1)n) schedule
  where include_history or competence>=date_trunc('month',current_date)::date;
  return jsonb_build_object('contractId',c.id,'monthlyValue',c.monthly_value,'startDate',c.start_date,'endDate',c.end_date,'termMonths',c.minimum_term_months,'billingDay',c.billing_day,'installmentCount',eligible,'firstDueDate',first_due,'lastDueDate',last_due,'totalExpected',eligible*c.monthly_value,'hasHistorical',first_month<date_trunc('month',current_date)::date);
end$$;

create or replace function public.generate_contract_installments(target_id uuid,include_history boolean default false,horizon integer default 3) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.contracts%rowtype;preview jsonb;first_month date;months integer;inserted integer:=0;event_name text;
begin
  if public.current_user_role() not in('admin','manager') then raise exception 'Você não tem permissão para gerar cobranças.';end if;
  preview:=public.preview_contract_installments(target_id,include_history,horizon);
  select * into c from public.contracts where id=target_id and organization_id=public.current_organization_id() for update;
  first_month:=date_trunc('month',c.start_date)::date;
  months:=case when coalesce(c.minimum_term_months,0)>0 then c.minimum_term_months when c.end_date is not null then greatest(1,(extract(year from age(c.end_date,c.start_date))*12+extract(month from age(c.end_date,c.start_date)))::integer) else greatest(1,least(horizon,3)) end;
  insert into public.invoice_installments(organization_id,client_id,contract_id,reference_month,installment_number,due_date,amount,received_amount,status,provider,idempotency_key)
  select c.organization_id,c.client_id,c.id,competence,n+1,make_date(extract(year from competence)::int,extract(month from competence)::int,least(c.billing_day,extract(day from(date_trunc('month',competence)+interval '1 month - 1 day'))::int)),c.monthly_value,0,'pending','manual',c.organization_id||':'||c.id||':'||competence
  from (select n,(first_month+(n||' months')::interval)::date competence from generate_series(0,months-1)n) schedule
  where include_history or competence>=date_trunc('month',current_date)::date
  on conflict(organization_id,contract_id,reference_month) do nothing;
  get diagnostics inserted=row_count;
  update public.contracts set status='active' where id=c.id;
  event_name:=case when exists(select 1 from public.commercial_events where contract_id=c.id and event_type='contract_installments_generated') then 'contract_installments_regenerated' else 'contract_installments_generated' end;
  if c.status is distinct from 'active' then insert into public.commercial_events(organization_id,client_id,contract_id,event_type,title,old_value,new_value,created_by) values(c.organization_id,c.client_id,c.id,'contract_activated','Contrato ativado',jsonb_build_object('status',c.status),jsonb_build_object('status','active'),auth.uid());end if;
  insert into public.commercial_events(organization_id,client_id,contract_id,event_type,title,new_value,created_by) values(c.organization_id,c.client_id,c.id,event_name,case when event_name='contract_installments_generated' then 'Cobranças do contrato geradas' else 'Próximas cobranças verificadas' end,jsonb_build_object('created',inserted,'includeHistorical',include_history,'preview',preview),auth.uid());
  return preview||jsonb_build_object('created',inserted);
end$$;

create or replace function public.confirm_installment_receipt(target_id uuid,new_received_amount numeric,received_on date,payment_method_name text,payment_note text default null) returns public.invoice_installments
language plpgsql security definer set search_path='' as $$
declare old_row public.invoice_installments%rowtype;new_row public.invoice_installments%rowtype;role_name text:=public.current_user_role();new_status text;event_name text;
begin
  if role_name not in('admin','manager') then raise exception 'Você não tem permissão para confirmar recebimentos.';end if;
  select * into old_row from public.invoice_installments where id=target_id and organization_id=public.current_organization_id() for update;
  if old_row.id is null then raise exception 'Parcela não encontrada.';end if;
  if new_received_amount<0 then raise exception 'O valor recebido não pode ser negativo.';end if;
  if new_received_amount<old_row.received_amount and role_name<>'admin' then raise exception 'Apenas administradores podem corrigir ou estornar recebimentos.';end if;
  new_status:=case when new_received_amount=0 then case when old_row.due_date<current_date then 'overdue' else 'pending' end when new_received_amount<old_row.amount then 'partial' else 'paid' end;
  event_name:=case when new_received_amount=0 and old_row.received_amount>0 then 'installment_payment_reversed' when new_received_amount<old_row.received_amount then 'installment_payment_corrected' when new_received_amount<old_row.amount then 'installment_partial_payment_registered' when old_row.received_amount>0 then 'installment_payment_corrected' else 'installment_payment_registered' end;
  update public.invoice_installments set received_amount=new_received_amount,status=new_status,paid_at=case when new_status='paid' then received_on::timestamptz else null end,payment_method=case when new_received_amount>0 then payment_method_name else null end,payment_notes=payment_note,operational_notes=payment_note,manual_confirmation_by=auth.uid(),manual_confirmation_at=now() where id=old_row.id returning * into new_row;
  insert into public.commercial_events(organization_id,client_id,contract_id,installment_id,event_type,title,description,old_value,new_value,created_by) values(old_row.organization_id,old_row.client_id,old_row.contract_id,old_row.id,event_name,case when new_status='partial' then 'Recebimento parcial registrado' when new_status='paid' then 'Recebimento de mensalidade registrado' when new_received_amount=0 then 'Recebimento estornado' else 'Recebimento corrigido' end,payment_note,to_jsonb(old_row),to_jsonb(new_row),auth.uid());
  return new_row;
end$$;

create or replace function public.financial_integrity_diagnostic() returns jsonb language sql security definer set search_path='' as $$ select case when public.is_admin() then jsonb_build_object(
  'activeContractsWithoutInstallments',(select count(*) from public.contracts c where c.organization_id=public.current_organization_id() and c.status='active' and not exists(select 1 from public.invoice_installments i where i.contract_id=c.id)),
  'contractsWithoutBillingDay',(select count(*) from public.contracts where organization_id=public.current_organization_id() and status='active' and billing_day is null),
  'contractsWithoutStartDate',(select count(*) from public.contracts where organization_id=public.current_organization_id() and status='active' and start_date is null),
  'duplicateInstallments',(select count(*) from(select contract_id,reference_month from public.invoice_installments where organization_id=public.current_organization_id() group by contract_id,reference_month having count(*)>1)x),
  'installmentsWithoutContract',(select count(*) from public.invoice_installments i left join public.contracts c on c.id=i.contract_id where i.organization_id=public.current_organization_id() and c.id is null),
  'installmentsWithoutClient',(select count(*) from public.invoice_installments i left join public.clients c on c.id=i.client_id where i.organization_id=public.current_organization_id() and c.id is null),
  'paidWithoutConfirmation',(select count(*) from public.invoice_installments where organization_id=public.current_organization_id() and status='paid' and manual_confirmation_at is null),
  'paymentsAboveExpected',(select count(*) from public.invoice_installments where organization_id=public.current_organization_id() and received_amount>amount),
  'expiredContractsWithFutureInstallments',(select count(*) from public.invoice_installments i join public.contracts c on c.id=i.contract_id where i.organization_id=public.current_organization_id() and c.end_date<current_date and i.due_date>c.end_date)
) else null end $$;
grant execute on function public.preview_contract_installments(uuid,boolean,integer),public.generate_contract_installments(uuid,boolean,integer),public.confirm_installment_receipt(uuid,numeric,date,text,text),public.financial_integrity_diagnostic() to authenticated;
