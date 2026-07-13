-- Sprint 10.1: recebimentos manuais, contato financeiro e auditoria imutável.
alter table public.contracts
  add column if not exists setup_received_amount numeric(14,2) not null default 0,
  add column if not exists setup_received_at timestamptz,
  add column if not exists setup_payment_method text,
  add column if not exists setup_payment_notes text;

alter table public.contracts
  drop constraint if exists contracts_setup_received_amount_nonnegative,
  add constraint contracts_setup_received_amount_nonnegative check(setup_received_amount >= 0),
  drop constraint if exists contracts_setup_payment_method_valid,
  add constraint contracts_setup_payment_method_valid check(setup_payment_method is null or setup_payment_method in('pix','transfer','ted','boleto','card','cash','other'));

alter table public.invoice_installments
  add column if not exists payment_method text,
  add column if not exists manual_confirmation_by uuid references auth.users(id),
  add column if not exists manual_confirmation_at timestamptz;

alter table public.invoice_installments
  drop constraint if exists invoice_installments_payment_method_valid,
  add constraint invoice_installments_payment_method_valid check(payment_method is null or payment_method in('pix','transfer','ted','boleto','card','cash','other'));

alter table public.clients
  add column if not exists billing_contact_name text,
  add column if not exists billing_contact_email text,
  add column if not exists billing_contact_phone text,
  add column if not exists billing_contact_role text;

create or replace function public.require_audited_receivable_registration() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_table_name='contracts' and coalesce(new.setup_received_amount,0)<>0 then
    raise exception 'Crie o contrato sem recebimento e registre o setup em uma atualização auditada.';
  end if;
  if tg_table_name='invoice_installments' and new.status in('paid','refunded') then
    raise exception 'Crie a parcela sem recebimento e confirme o pagamento em uma atualização auditada.';
  end if;
  return new;
end$$;

drop trigger if exists require_contract_setup_audit on public.contracts;
create trigger require_contract_setup_audit before insert on public.contracts for each row execute function public.require_audited_receivable_registration();
drop trigger if exists require_installment_payment_audit on public.invoice_installments;
create trigger require_installment_payment_audit before insert on public.invoice_installments for each row execute function public.require_audited_receivable_registration();

create or replace function public.audit_manual_receivables() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  role_name text := public.current_user_role();
  event_name text;
begin
  if tg_table_name = 'contracts' and new.setup_received_amount is distinct from old.setup_received_amount then
    if role_name not in ('admin','manager') then raise exception 'Apenas administradores e gestores podem registrar recebimentos.'; end if;
    if new.setup_received_amount < old.setup_received_amount and role_name <> 'admin' then raise exception 'Apenas administradores podem corrigir ou estornar recebimentos.'; end if;
    if new.setup_received_amount > coalesce(new.setup_value,0) and (role_name <> 'admin' or nullif(trim(new.setup_payment_notes),'') is null) then raise exception 'Divergência acima do setup exige administrador e justificativa documentada.'; end if;
    event_name := case when new.setup_received_amount < old.setup_received_amount then 'setup_payment_reversed' when old.setup_received_amount = 0 then 'setup_payment_registered' else 'setup_payment_updated' end;
    insert into public.commercial_events(organization_id,client_id,contract_id,event_type,title,description,old_value,new_value,created_by)
    values(new.organization_id,new.client_id,new.id,event_name,case when event_name='setup_payment_reversed' then 'Recebimento do setup corrigido' else 'Recebimento do setup registrado' end,new.setup_payment_notes,jsonb_build_object('amount',old.setup_received_amount,'method',old.setup_payment_method,'received_at',old.setup_received_at),jsonb_build_object('amount',new.setup_received_amount,'method',new.setup_payment_method,'received_at',new.setup_received_at,'notes',new.setup_payment_notes),auth.uid());
  elsif tg_table_name = 'invoice_installments' and new.status is distinct from old.status and (new.status='paid' or old.status='paid') then
    if role_name not in ('admin','manager') then raise exception 'Apenas administradores e gestores podem confirmar recebimentos.'; end if;
    if old.status='paid' and new.status<>'paid' and role_name <> 'admin' then raise exception 'Apenas administradores podem estornar recebimentos.'; end if;
    event_name := case when new.status='paid' then 'installment_payment_registered' else 'installment_payment_reversed' end;
    if new.status='paid' then new.manual_confirmation_by:=auth.uid();new.manual_confirmation_at:=coalesce(new.manual_confirmation_at,now());new.paid_at:=coalesce(new.paid_at,now()); end if;
    insert into public.commercial_events(organization_id,client_id,contract_id,event_type,title,description,old_value,new_value,created_by)
    values(new.organization_id,new.client_id,new.contract_id,event_name,case when new.status='paid' then 'Recebimento de mensalidade registrado' else 'Recebimento de mensalidade estornado' end,new.operational_notes,jsonb_build_object('status',old.status,'amount',old.amount,'method',old.payment_method,'paid_at',old.paid_at),jsonb_build_object('status',new.status,'amount',new.amount,'method',new.payment_method,'paid_at',new.paid_at),auth.uid());
  end if;
  return new;
end$$;

drop trigger if exists audit_contract_setup_receivable on public.contracts;
create trigger audit_contract_setup_receivable before update of setup_received_amount on public.contracts for each row execute function public.audit_manual_receivables();
drop trigger if exists audit_installment_receivable on public.invoice_installments;
create trigger audit_installment_receivable before update of status on public.invoice_installments for each row execute function public.audit_manual_receivables();

-- Impede remoção do histórico financeiro por usuários autenticados.
drop policy if exists commercial_events_write on public.commercial_events;
create policy commercial_events_insert on public.commercial_events for insert to authenticated with check(organization_id=public.current_organization_id() and public.can_write());
