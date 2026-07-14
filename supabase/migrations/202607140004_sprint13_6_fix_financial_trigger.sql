-- Sprint 13.6: separa triggers polimórficas que acessavam campos de tabelas diferentes.
-- A falha ocorria no INSERT de invoice_installments: NEW não possui setup_received_amount.

drop trigger if exists require_contract_setup_audit on public.contracts;
drop trigger if exists require_installment_payment_audit on public.invoice_installments;
drop trigger if exists audit_contract_setup_receivable on public.contracts;
drop trigger if exists audit_installment_receivable on public.invoice_installments;

create or replace function public.require_contract_setup_audit() returns trigger
language plpgsql set search_path='' as $$
begin
  if coalesce(new.setup_received_amount,0)<>0 then
    raise exception 'Crie o contrato sem recebimento e registre o setup em uma atualização auditada.';
  end if;
  return new;
end$$;

create or replace function public.require_installment_payment_audit() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.status in('paid','refunded') then
    raise exception 'Crie a parcela sem recebimento e confirme o pagamento em uma atualização auditada.';
  end if;
  return new;
end$$;

create trigger require_contract_setup_audit before insert on public.contracts
for each row execute function public.require_contract_setup_audit();
create trigger require_installment_payment_audit before insert on public.invoice_installments
for each row execute function public.require_installment_payment_audit();

-- Compatibilidade temporária com recebimentos de setup legados gravados no contrato.
-- Novas cobranças de setup são parcelas e permanecem como fonte financeira principal.
create or replace function public.audit_contract_setup_receivable() returns trigger
language plpgsql security definer set search_path='' as $$
declare role_name text:=public.current_user_role();event_name text;
begin
  if new.setup_received_amount is not distinct from old.setup_received_amount then return new;end if;
  if role_name not in('admin','manager') then raise exception 'Apenas administradores e gestores podem registrar recebimentos.';end if;
  if new.setup_received_amount<old.setup_received_amount and role_name<>'admin' then raise exception 'Apenas administradores podem corrigir ou estornar recebimentos.';end if;
  if new.setup_received_amount>coalesce(new.setup_value,0) and(role_name<>'admin' or nullif(trim(new.setup_payment_notes),'') is null) then raise exception 'Divergência acima do setup exige administrador e justificativa documentada.';end if;
  event_name:=case when new.setup_received_amount<old.setup_received_amount then 'setup_payment_reversed' when old.setup_received_amount=0 then 'setup_payment_registered' else 'setup_payment_updated' end;
  insert into public.commercial_events(organization_id,client_id,contract_id,event_type,title,description,old_value,new_value,created_by)
  values(new.organization_id,new.client_id,new.id,event_name,case when event_name='setup_payment_reversed' then 'Recebimento do setup corrigido' else 'Recebimento do setup registrado' end,new.setup_payment_notes,jsonb_build_object('amount',old.setup_received_amount,'method',old.setup_payment_method,'received_at',old.setup_received_at),jsonb_build_object('amount',new.setup_received_amount,'method',new.setup_payment_method,'received_at',new.setup_received_at,'notes',new.setup_payment_notes),auth.uid());
  return new;
end$$;

create or replace function public.audit_installment_receivable() returns trigger
language plpgsql security definer set search_path='' as $$
declare role_name text:=public.current_user_role();event_name text;
begin
  if new.status is not distinct from old.status or(new.status<>'paid' and old.status<>'paid') then return new;end if;
  if role_name not in('admin','manager') then raise exception 'Apenas administradores e gestores podem confirmar recebimentos.';end if;
  if old.status='paid' and new.status<>'paid' and role_name<>'admin' then raise exception 'Apenas administradores podem estornar recebimentos.';end if;
  event_name:=case when new.status='paid' then 'installment_payment_registered' else 'installment_payment_reversed' end;
  if new.status='paid' then
    new.manual_confirmation_by:=auth.uid();
    new.manual_confirmation_at:=coalesce(new.manual_confirmation_at,now());
    new.paid_at:=coalesce(new.paid_at,now());
  end if;
  insert into public.commercial_events(organization_id,client_id,contract_id,installment_id,event_type,title,description,old_value,new_value,created_by)
  values(new.organization_id,new.client_id,new.contract_id,new.id,event_name,case when new.status='paid' then 'Recebimento de mensalidade registrado' else 'Recebimento de mensalidade estornado' end,new.operational_notes,jsonb_build_object('status',old.status,'amount',old.amount,'method',old.payment_method,'paid_at',old.paid_at),jsonb_build_object('status',new.status,'amount',new.amount,'method',new.payment_method,'paid_at',new.paid_at),auth.uid());
  return new;
end$$;

create trigger audit_contract_setup_receivable before update of setup_received_amount on public.contracts
for each row execute function public.audit_contract_setup_receivable();
create trigger audit_installment_receivable before update of status on public.invoice_installments
for each row execute function public.audit_installment_receivable();

-- As funções polimórficas antigas ficam sem triggers dependentes e são removidas.
drop function if exists public.require_audited_receivable_registration();
drop function if exists public.audit_manual_receivables();

revoke all on function public.require_contract_setup_audit(),public.require_installment_payment_audit(),public.audit_contract_setup_receivable(),public.audit_installment_receivable() from public;

