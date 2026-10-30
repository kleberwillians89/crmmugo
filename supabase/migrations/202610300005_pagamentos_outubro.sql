-- Fechamento dos recebimentos de outubro/2026 (dados). Depende da 202610300002 (limpeza da carteira).
--
-- 1) Mensalidades de out/2026 dos clientes ativos: todas recebidas, EXCETO Roove (segue pendente).
--    Se faltar a parcela do mês, ela é criada (já recebida, ou pendente no caso da Roove).
-- 2) Freelas recebidos em out/2026 no Caixa Freela: site Mila (R$ 2.000) e Tatitagarela (R$ 830).
-- 3) WhatsApp da conversa "ROOVE" (+55 11 99125-6145) vira contato do cliente Roove,
--    para a cobrança por modelo aceitar esse número.
--
-- Transacional e idempotente: pode ser rodada de novo sem duplicar nada.

begin;

do $outubro$
declare
  v_org uuid;
  v_month date := date '2026-10-01';
  v_roove uuid;
  v_contract record;
  v_row public.invoice_installments%rowtype;
  v_paid_on date;
  v_n integer := 0;
  v_created integer := 0;
  v_report text := '';
begin
  select id into v_org from public.organizations where slug = 'mugo' limit 1;
  if v_org is null then raise notice 'Organização mugo não encontrada; nada alterado.'; return; end if;

  if exists (select 1 from public.financial_month_closings
             where organization_id = v_org and competence = v_month and status = 'closed') then
    raise exception 'Outubro/2026 já está fechado. Reabra a competência antes de rodar esta migration.';
  end if;

  select c.id into v_roove from public.clients c
  where c.organization_id = v_org and c.deleted_at is null and c.status = 'active'
    and (c.company_name ilike '%roove%' or coalesce(c.trade_name, '') ilike '%roove%')
  order by c.created_at limit 1;
  if v_roove is null then raise exception 'Cliente Roove ativo não encontrado; nada alterado.'; end if;

  -- O RPC confirm_installment_receipt usa esta flag para o trigger de auditoria não exigir sessão.
  perform set_config('app.receipt_rpc', 'true', true);

  for v_contract in
    select k.id, k.client_id, k.monthly_value, coalesce(k.billing_day, 5) as billing_day, c.trade_name, c.company_name
    from public.contracts k
    join public.clients c on c.id = k.client_id
    where k.organization_id = v_org and k.status = 'active' and k.deleted_at is null
      and c.status = 'active' and c.deleted_at is null
      and coalesce(k.monthly_value, 0) > 0
  loop
    -- Garante a parcela mensal de outubro.
    if not exists (select 1 from public.invoice_installments x
                   where x.organization_id = v_org and x.contract_id = v_contract.id
                     and x.reference_month = v_month and x.installment_type = 'monthly'
                     and x.status <> 'cancelled') then
      insert into public.invoice_installments(organization_id, client_id, contract_id, reference_month, installment_number,
        due_date, amount, status, installment_type, currency, original_amount, description, source)
      values (v_org, v_contract.client_id, v_contract.id, v_month,
        coalesce((select max(installment_number) + 1 from public.invoice_installments
                  where organization_id = v_org and contract_id = v_contract.id and reference_month = v_month), 1),
        (v_month + (least(v_contract.billing_day, 31) - 1))::date,
        v_contract.monthly_value, 'pending', 'monthly', 'BRL', v_contract.monthly_value, 'Mensalidade outubro/2026', 'contract');
      v_created := v_created + 1;
    end if;

    if v_contract.client_id = v_roove then
      v_report := v_report || format(E'\n%s: mantida pendente', coalesce(v_contract.trade_name, v_contract.company_name));
      continue;
    end if;

    for v_row in
      select * from public.invoice_installments i
      where i.organization_id = v_org and i.contract_id = v_contract.id
        and i.reference_month = v_month and i.installment_type = 'monthly'
        and i.status in ('draft', 'pending', 'overdue', 'partial')
      for update
    loop
      v_paid_on := least(v_row.due_date, date '2026-10-30');
      update public.invoice_installments
        set received_amount = amount, actual_brl_amount = amount, status = 'paid',
          paid_at = v_paid_on::timestamptz, payment_method = coalesce(payment_method, 'pix'),
          payment_notes = 'Recebimento de outubro/2026 confirmado em 30/10/2026.',
          operational_notes = concat_ws(E'\n', nullif(operational_notes, ''), 'Recebimento de outubro/2026 confirmado em 30/10/2026.'),
          manual_confirmation_at = now()
      where id = v_row.id;
      insert into public.commercial_events(organization_id, client_id, contract_id, installment_id, event_type, title, description, old_value, new_value)
      values (v_org, v_row.client_id, v_row.contract_id, v_row.id, 'installment_payment_registered',
        'Recebimento de mensalidade registrado', 'Fechamento de outubro/2026',
        jsonb_build_object('status', v_row.status, 'amount', v_row.amount, 'received', v_row.received_amount),
        jsonb_build_object('status', 'paid', 'amount', v_row.amount, 'received', v_row.amount));
      v_n := v_n + 1;
      v_report := v_report || format(E'\n%s: R$ %s recebido', coalesce(v_contract.trade_name, v_contract.company_name), v_row.amount);
    end loop;
  end loop;

  -- Freelas recebidos no mês.
  insert into public.freelance_cash_movements(organization_id, project_source, type, status, amount, movement_date, competence, notes, idempotency_key)
  values
    (v_org, 'Site Mila', 'income', 'received', 2000, date '2026-10-30', v_month, 'Freela site Mila — outubro/2026.', 'freela-2026-10-site-mila'),
    (v_org, 'Tatitagarela', 'income', 'received', 830, date '2026-10-30', v_month, 'Freela Tatitagarela — outubro/2026.', 'freela-2026-10-tatitagarela')
  on conflict (organization_id, idempotency_key) do nothing;

  -- Número da conversa "ROOVE" como contato do cliente.
  if not exists (select 1 from public.client_contacts
                 where client_id = v_roove and active
                   and public.normalize_phone_digits(phone) = public.normalize_phone_digits('+5511991256145')) then
    insert into public.client_contacts(organization_id, client_id, name, phone, is_primary, notes, created_by)
    values (v_org, v_roove, 'ROOVE', '+5511991256145', false, 'WhatsApp da conversa ROOVE (30/10/2026).', null);
  end if;

  raise notice 'Outubro/2026: % parcela(s) criada(s), % marcada(s) como recebida(s).%', v_created, v_n, v_report;
end
$outubro$;

commit;
