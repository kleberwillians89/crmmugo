-- Arquivamento e exclusão permanente protegida de contratos e propostas.
create or replace function public.archive_contract(target_id uuid) returns public.contracts language plpgsql security definer set search_path='' as $$
declare row_data public.contracts%rowtype;
begin
  if public.current_user_role() not in('admin','manager') then raise exception 'Você não tem permissão para arquivar contratos.';end if;
  update public.contracts set deleted_at=coalesce(deleted_at,now()),deleted_by=auth.uid(),updated_by=auth.uid(),updated_at=now() where id=target_id and organization_id=public.current_organization_id() returning * into row_data;
  if row_data.id is null then raise exception 'Contrato não encontrado.';end if;
  insert into public.commercial_events(organization_id,client_id,proposal_id,contract_id,event_type,title,new_value,created_by) values(row_data.organization_id,row_data.client_id,row_data.proposal_id,row_data.id,'contract_archived','Contrato arquivado',jsonb_build_object('deleted_at',row_data.deleted_at),auth.uid());
  return row_data;
end$$;

create or replace function public.restore_contract(target_id uuid) returns public.contracts language plpgsql security definer set search_path='' as $$
declare row_data public.contracts%rowtype;
begin
  if public.current_user_role() not in('admin','manager') then raise exception 'Você não tem permissão para restaurar contratos.';end if;
  update public.contracts set deleted_at=null,deleted_by=null,updated_by=auth.uid(),updated_at=now() where id=target_id and organization_id=public.current_organization_id() returning * into row_data;
  if row_data.id is null then raise exception 'Contrato não encontrado.';end if;
  insert into public.commercial_events(organization_id,client_id,proposal_id,contract_id,event_type,title,created_by) values(row_data.organization_id,row_data.client_id,row_data.proposal_id,row_data.id,'contract_restored','Contrato restaurado',auth.uid());
  return row_data;
end$$;

create or replace function public.get_contract_deletion_impact(target_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.contracts%rowtype;
begin
  if public.current_user_role() not in('admin','manager') then raise exception 'Você não tem permissão para consultar este impacto.';end if;
  select * into c from public.contracts where id=target_id and organization_id=public.current_organization_id();
  if c.id is null then raise exception 'Contrato não encontrado.';end if;
  return jsonb_build_object('contractId',c.id,'archived',c.deleted_at is not null,'setupReceived',coalesce(c.setup_received_amount,0),'installments',(select count(*) from public.invoice_installments where contract_id=c.id),'receivedInstallments',(select count(*) from public.invoice_installments where contract_id=c.id and (coalesce(received_amount,0)>0 or status in('paid','partial'))),'payments',(select count(*) from public.payments p join public.invoice_installments i on i.id=p.installment_id where i.contract_id=c.id),'confirmedPayments',(select count(*) from public.payments p join public.invoice_installments i on i.id=p.installment_id where i.contract_id=c.id and (p.paid_at is not null or p.status='paid')),'services',(select count(*) from public.contract_services where contract_id=c.id),'documents',(select count(*) from public.documents where contract_id=c.id),'events',(select count(*) from public.commercial_events where contract_id=c.id),'proposalLinked',c.proposal_id is not null,'blocked',coalesce(c.setup_received_amount,0)>0 or exists(select 1 from public.invoice_installments where contract_id=c.id and (coalesce(received_amount,0)>0 or status in('paid','partial'))) or exists(select 1 from public.payments p join public.invoice_installments i on i.id=p.installment_id where i.contract_id=c.id and (p.paid_at is not null or p.status='paid')));
end$$;

create or replace function public.delete_contract_permanently(target_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.contracts%rowtype;impact jsonb;installment_ids uuid[];service_count integer;document_count integer;event_count integer;installment_count integer;payment_count integer;
begin
  if not public.is_admin() then raise exception 'Apenas administradores podem excluir contratos permanentemente.';end if;
  select * into c from public.contracts where id=target_id and organization_id=public.current_organization_id() for update;
  if c.id is null then raise exception 'Contrato não encontrado.';end if;
  if c.deleted_at is null then raise exception 'Arquive o contrato antes da exclusão permanente.';end if;
  impact:=public.get_contract_deletion_impact(target_id);
  if (impact->>'blocked')::boolean then raise exception 'Este contrato possui recebimentos confirmados e não pode ser excluído permanentemente.';end if;
  select coalesce(array_agg(id),'{}'::uuid[]) into installment_ids from public.invoice_installments where contract_id=c.id;
  select count(*) into service_count from public.contract_services where contract_id=c.id;
  select count(*) into document_count from public.documents where contract_id=c.id;
  select count(*) into event_count from public.commercial_events where contract_id=c.id;
  select count(*) into installment_count from public.invoice_installments where contract_id=c.id;
  select count(*) into payment_count from public.payments where installment_id=any(installment_ids);
  update public.documents set contract_id=null where contract_id=c.id;
  update public.commercial_events set contract_id=null,installment_id=null,new_value=coalesce(new_value,'{}'::jsonb)||jsonb_build_object('deleted_contract_id',c.id) where contract_id=c.id or installment_id=any(installment_ids);
  delete from public.payment_events where installment_id=any(installment_ids);
  delete from public.payments where installment_id=any(installment_ids);
  delete from public.invoice_installments where contract_id=c.id;
  delete from public.contract_services where contract_id=c.id;
  delete from public.contracts where id=c.id;
  insert into public.commercial_events(organization_id,client_id,proposal_id,event_type,title,description,old_value,new_value,created_by) values(c.organization_id,c.client_id,c.proposal_id,'contract_permanently_deleted','Contrato excluído permanentemente','Exclusão administrativa protegida.',jsonb_build_object('id',c.id,'number',c.contract_number,'status',c.status),jsonb_build_object('services',service_count,'documents_preserved',document_count,'events_preserved',event_count,'installments',installment_count,'payments',payment_count),auth.uid());
  return jsonb_build_object('contractId',c.id,'servicesDeleted',service_count,'documentsPreserved',document_count,'eventsPreserved',event_count,'installmentsDeleted',installment_count,'paymentsDeleted',payment_count);
end$$;

create or replace function public.archive_proposal(target_id uuid) returns public.proposals language plpgsql security definer set search_path='' as $$
declare row_data public.proposals%rowtype;
begin
  if public.current_user_role() not in('admin','manager') then raise exception 'Você não tem permissão para arquivar propostas.';end if;
  update public.proposals set deleted_at=coalesce(deleted_at,now()),deleted_by=auth.uid(),updated_by=auth.uid(),updated_at=now() where id=target_id and organization_id=public.current_organization_id() returning * into row_data;
  if row_data.id is null then raise exception 'Proposta não encontrada.';end if;
  insert into public.commercial_events(organization_id,client_id,proposal_id,event_type,title,new_value,created_by) values(row_data.organization_id,row_data.client_id,row_data.id,'proposal_archived','Proposta arquivada',jsonb_build_object('deleted_at',row_data.deleted_at),auth.uid());
  return row_data;
end$$;

create or replace function public.restore_proposal(target_id uuid) returns public.proposals language plpgsql security definer set search_path='' as $$
declare row_data public.proposals%rowtype;
begin
  if public.current_user_role() not in('admin','manager') then raise exception 'Você não tem permissão para restaurar propostas.';end if;
  update public.proposals set deleted_at=null,deleted_by=null,updated_by=auth.uid(),updated_at=now() where id=target_id and organization_id=public.current_organization_id() returning * into row_data;
  if row_data.id is null then raise exception 'Proposta não encontrada.';end if;
  insert into public.commercial_events(organization_id,client_id,proposal_id,event_type,title,created_by) values(row_data.organization_id,row_data.client_id,row_data.id,'proposal_restored','Proposta restaurada',auth.uid());
  return row_data;
end$$;

create or replace function public.get_proposal_deletion_impact(target_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.proposals%rowtype;
begin
  if public.current_user_role() not in('admin','manager') then raise exception 'Você não tem permissão para consultar este impacto.';end if;
  select * into p from public.proposals where id=target_id and organization_id=public.current_organization_id();
  if p.id is null then raise exception 'Proposta não encontrada.';end if;
  return jsonb_build_object('proposalId',p.id,'archived',p.deleted_at is not null,'contracts',(select count(*) from public.contracts where proposal_id=p.id),'services',(select count(*) from public.proposal_services where proposal_id=p.id),'documents',(select count(*) from public.documents where proposal_id=p.id),'events',(select count(*) from public.commercial_events where proposal_id=p.id),'blocked',exists(select 1 from public.contracts where proposal_id=p.id));
end$$;

create or replace function public.delete_proposal_permanently(target_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.proposals%rowtype;impact jsonb;service_count integer;document_count integer;event_count integer;
begin
  if not public.is_admin() then raise exception 'Apenas administradores podem excluir propostas permanentemente.';end if;
  select * into p from public.proposals where id=target_id and organization_id=public.current_organization_id() for update;
  if p.id is null then raise exception 'Proposta não encontrada.';end if;
  if p.deleted_at is null then raise exception 'Arquive a proposta antes da exclusão permanente.';end if;
  impact:=public.get_proposal_deletion_impact(target_id);
  if (impact->>'blocked')::boolean then raise exception 'Esta proposta está vinculada a um contrato e não pode ser excluída permanentemente. Arquive-a.';end if;
  select count(*) into service_count from public.proposal_services where proposal_id=p.id;
  select count(*) into document_count from public.documents where proposal_id=p.id;
  select count(*) into event_count from public.commercial_events where proposal_id=p.id;
  update public.documents set proposal_id=null where proposal_id=p.id;
  update public.commercial_events set proposal_id=null,new_value=coalesce(new_value,'{}'::jsonb)||jsonb_build_object('deleted_proposal_id',p.id) where proposal_id=p.id;
  delete from public.proposal_services where proposal_id=p.id;
  delete from public.proposals where id=p.id;
  insert into public.commercial_events(organization_id,client_id,event_type,title,description,old_value,new_value,created_by) values(p.organization_id,p.client_id,'proposal_permanently_deleted','Proposta excluída permanentemente','Exclusão administrativa protegida.',jsonb_build_object('id',p.id,'title',p.title,'status',p.status),jsonb_build_object('services',service_count,'documents_preserved',document_count,'events_preserved',event_count),auth.uid());
  return jsonb_build_object('proposalId',p.id,'servicesDeleted',service_count,'documentsPreserved',document_count,'eventsPreserved',event_count);
end$$;

revoke all on function public.archive_contract(uuid),public.restore_contract(uuid),public.get_contract_deletion_impact(uuid),public.delete_contract_permanently(uuid),public.archive_proposal(uuid),public.restore_proposal(uuid),public.get_proposal_deletion_impact(uuid),public.delete_proposal_permanently(uuid) from public;
grant execute on function public.archive_contract(uuid),public.restore_contract(uuid),public.get_contract_deletion_impact(uuid),public.archive_proposal(uuid),public.restore_proposal(uuid),public.get_proposal_deletion_impact(uuid) to authenticated;
grant execute on function public.delete_contract_permanently(uuid),public.delete_proposal_permanently(uuid) to authenticated;
