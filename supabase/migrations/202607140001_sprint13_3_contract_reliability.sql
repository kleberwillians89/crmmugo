-- Auditoria de contratos: operações atômicas, policies explícitas e diagnóstico de duplicidade.
drop policy if exists contracts_read on public.contracts;
create policy contracts_read on public.contracts for select to authenticated
using(organization_id=public.current_organization_id() and public.is_active_user());
drop policy if exists contracts_write on public.contracts;
create policy contracts_write on public.contracts for all to authenticated
using(organization_id=public.current_organization_id() and public.can_write())
with check(organization_id=public.current_organization_id() and public.can_write());

create or replace function public.cancel_contract(target_id uuid,cancellation_reason text default null)
returns public.contracts language plpgsql security definer set search_path='' as $$
declare current_row public.contracts%rowtype;updated_row public.contracts%rowtype;cancelled_installments integer:=0;
begin
  if public.current_user_role() not in('admin','manager') then raise exception 'Você não tem permissão para cancelar contratos.';end if;
  if nullif(trim(cancellation_reason),'') is null then raise exception 'Informe o motivo do cancelamento.';end if;
  select * into current_row from public.contracts where id=target_id and organization_id=public.current_organization_id() and deleted_at is null for update;
  if current_row.id is null then raise exception 'Contrato não encontrado.';end if;
  if current_row.status in('cancelled','terminated') then raise exception 'O contrato já está encerrado.';end if;
  update public.contracts set status='cancelled',termination_date=current_date,termination_reason=trim(cancellation_reason),updated_by=auth.uid(),updated_at=now() where id=current_row.id returning * into updated_row;
  update public.invoice_installments set status='cancelled',cancelled_at=now(),updated_at=now() where contract_id=current_row.id and organization_id=current_row.organization_id and status in('draft','pending','overdue','failed') and coalesce(received_amount,0)=0;
  get diagnostics cancelled_installments=row_count;
  insert into public.commercial_events(organization_id,client_id,proposal_id,contract_id,event_type,title,description,old_value,new_value,created_by)
  values(current_row.organization_id,current_row.client_id,current_row.proposal_id,current_row.id,'contract_cancelled','Contrato cancelado',trim(cancellation_reason),jsonb_build_object('status',current_row.status),jsonb_build_object('status','cancelled','termination_date',current_date,'termination_reason',trim(cancellation_reason),'cancelled_installments',cancelled_installments),auth.uid());
  return updated_row;
end$$;

create or replace function public.renew_contract(target_id uuid,new_end_date date,new_minimum_term_months integer default null)
returns public.contracts language plpgsql security definer set search_path='' as $$
declare current_row public.contracts%rowtype;updated_row public.contracts%rowtype;
begin
  if public.current_user_role() not in('admin','manager') then raise exception 'Você não tem permissão para renovar contratos.';end if;
  select * into current_row from public.contracts where id=target_id and organization_id=public.current_organization_id() and deleted_at is null for update;
  if current_row.id is null then raise exception 'Contrato não encontrado.';end if;
  if new_end_date is null or (current_row.start_date is not null and new_end_date<current_row.start_date) then raise exception 'Informe uma nova data final válida.';end if;
  if new_minimum_term_months is not null and new_minimum_term_months<0 then raise exception 'O prazo mínimo não pode ser negativo.';end if;
  update public.contracts set end_date=new_end_date,minimum_term_months=coalesce(new_minimum_term_months,minimum_term_months),renewal_status='active',status=case when signed then 'active' else status end,updated_by=auth.uid(),updated_at=now() where id=current_row.id returning * into updated_row;
  insert into public.commercial_events(organization_id,client_id,proposal_id,contract_id,event_type,title,old_value,new_value,created_by)
  values(current_row.organization_id,current_row.client_id,current_row.proposal_id,current_row.id,'contract_renewed','Contrato renovado',jsonb_build_object('end_date',current_row.end_date,'minimum_term_months',current_row.minimum_term_months),jsonb_build_object('end_date',updated_row.end_date,'minimum_term_months',updated_row.minimum_term_months),auth.uid());
  return updated_row;
end$$;

revoke all on function public.cancel_contract(uuid,text),public.renew_contract(uuid,date,integer) from public;
grant execute on function public.cancel_contract(uuid,text),public.renew_contract(uuid,date,integer) to authenticated;

create or replace function public.contract_reliability_diagnostic() returns jsonb language sql security definer set search_path='' as $$
select case when public.is_admin() then jsonb_build_object(
  'contractsWithoutClient',(select count(*) from public.contracts c left join public.clients cl on cl.id=c.client_id where c.organization_id=public.current_organization_id() and cl.id is null),
  'contractsWithoutResponsible',(select count(*) from public.contracts where organization_id=public.current_organization_id() and deleted_at is null and responsible_id is null),
  'activeUnsignedContracts',(select count(*) from public.contracts where organization_id=public.current_organization_id() and deleted_at is null and status='active' and not signed),
  'duplicateClientContracts',(select count(*) from(select client_id from public.contracts where organization_id=public.current_organization_id() and deleted_at is null and status not in('cancelled','terminated') group by client_id having count(*)>1)x),
  'duplicateProposalContracts',(select count(*) from(select proposal_id from public.contracts where organization_id=public.current_organization_id() and deleted_at is null and proposal_id is not null group by proposal_id having count(*)>1)x),
  'writePolicyAvailable',(select count(*)>0 from pg_catalog.pg_policies where schemaname='public' and tablename='contracts' and policyname='contracts_write'),
  'cancelRpcAvailable',to_regprocedure('public.cancel_contract(uuid,text)') is not null,
  'renewRpcAvailable',to_regprocedure('public.renew_contract(uuid,date,integer)') is not null
) else null end $$;
revoke all on function public.contract_reliability_diagnostic() from public;
grant execute on function public.contract_reliability_diagnostic() to authenticated;
