-- Cobrança pelo Asaas: o Asaas calcula multa e juros depois do vencimento; o CRM só informa os
-- percentuais ao criar a cobrança e recebe a baixa pelo webhook.

begin;

alter table public.organization_settings
  add column if not exists asaas_fine_percent numeric(5,2) not null default 2 check (asaas_fine_percent >= 0 and asaas_fine_percent <= 100),
  add column if not exists asaas_interest_percent numeric(5,2) not null default 1 check (asaas_interest_percent >= 0 and asaas_interest_percent <= 100),
  add column if not exists asaas_billing_type text not null default 'UNDEFINED' check (asaas_billing_type in ('UNDEFINED', 'PIX', 'BOLETO', 'CREDIT_CARD'));
comment on column public.organization_settings.asaas_fine_percent is 'Multa (%) aplicada pelo Asaas após o vencimento.';
comment on column public.organization_settings.asaas_interest_percent is 'Juros (% ao mês) aplicados pelo Asaas após o vencimento.';
comment on column public.organization_settings.asaas_billing_type is 'UNDEFINED = cliente escolhe Pix, boleto ou cartão no link do Asaas.';

alter table public.clients add column if not exists asaas_customer_id text;
create unique index if not exists clients_asaas_customer_unique on public.clients(organization_id, asaas_customer_id) where asaas_customer_id is not null;

-- invoice_installments já tem provider, provider_invoice_id, payment_url, boleto_url e pix_copy_paste.
create unique index if not exists invoice_installments_provider_invoice_unique
  on public.invoice_installments(provider, provider_invoice_id) where provider_invoice_id is not null;

-- Eventos recebidos do Asaas (entrega "at least once": o id do evento evita processar duas vezes).
create table if not exists public.asaas_webhook_events(
  id text primary key,
  organization_id uuid references public.organizations(id),
  event text not null,
  payment_id text,
  installment_id uuid references public.invoice_installments(id),
  payload jsonb not null,
  status text not null default 'received' check (status in ('received', 'processed', 'ignored', 'failed')),
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
alter table public.asaas_webhook_events enable row level security;
drop policy if exists asaas_webhook_events_read on public.asaas_webhook_events;
create policy asaas_webhook_events_read on public.asaas_webhook_events for select to authenticated
  using (organization_id = public.current_organization_id() and public.can_write());
grant select on public.asaas_webhook_events to authenticated;
grant all on public.asaas_webhook_events to service_role;

-- Baixa automática vinda do Asaas. Só o service_role (webhook) chama. Idempotente.
-- O valor recebido na parcela é limitado ao valor dela; multa/juros pagos ficam registrados à parte.
create or replace function public.confirm_installment_receipt_asaas(
  p_installment_id uuid, p_payment_id text, p_paid_value numeric, p_paid_on date, p_billing_type text
) returns public.invoice_installments
language plpgsql security definer set search_path = '' as $$
declare r public.invoice_installments; v_method text; v_extra numeric;
begin
  if coalesce(auth.role(), '') <> 'service_role' and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Função exclusiva do webhook do Asaas.';
  end if;
  select * into r from public.invoice_installments where id = p_installment_id for update;
  if not found then raise exception 'Parcela não encontrada.'; end if;
  if r.status = 'paid' then return r; end if;
  if r.status = 'cancelled' then raise exception 'Parcela cancelada no CRM recebeu pagamento no Asaas (%).', p_payment_id; end if;
  v_method := case upper(coalesce(p_billing_type, '')) when 'PIX' then 'pix' when 'BOLETO' then 'boleto'
    when 'CREDIT_CARD' then 'card' when 'DEBIT_CARD' then 'card' when 'TRANSFER' then 'transfer' else 'other' end;
  v_extra := greatest(coalesce(p_paid_value, 0) - r.amount, 0);
  perform set_config('app.receipt_rpc', 'true', true);
  update public.invoice_installments set
    received_amount = least(r.amount, coalesce(p_paid_value, 0)),
    actual_brl_amount = coalesce(p_paid_value, 0),
    status = case when coalesce(p_paid_value, 0) >= r.amount then 'paid' else 'partial' end,
    paid_at = case when coalesce(p_paid_value, 0) >= r.amount then coalesce(p_paid_on, current_date)::timestamptz else null end,
    payment_method = v_method,
    payment_notes = concat_ws(' · ', 'Pago no Asaas ' || p_payment_id, case when v_extra > 0 then 'multa/juros R$ ' || to_char(v_extra, 'FM999G999G990D00') end),
    manual_confirmation_at = now()
  where id = r.id returning * into r;
  insert into public.commercial_events(organization_id, client_id, contract_id, installment_id, event_type, title, description, new_value)
  values (r.organization_id, r.client_id, r.contract_id, r.id, 'installment_payment_registered', 'Pagamento confirmado pelo Asaas',
    'Cobrança ' || p_payment_id, jsonb_build_object('paid_value', p_paid_value, 'late_fees', v_extra, 'method', v_method, 'paid_on', p_paid_on));
  return r;
end $$;
revoke all on function public.confirm_installment_receipt_asaas(uuid, text, numeric, date, text) from public, anon, authenticated;
grant execute on function public.confirm_installment_receipt_asaas(uuid, text, numeric, date, text) to service_role;

commit;
