-- Limpeza da carteira de 30/10/2026 (dados). Depende da 202610300001.
--
-- Rode antes, se quiser conferir, supabase/validation/202610300002_limpeza_preview.sql (somente leitura).
-- Transacional: se algum cliente da lista estiver ambíguo (mais de um cadastro com contrato ativo),
-- aborta inteira e nada é alterado. Pode ser rodada de novo sem duplicar nada.

begin;

-- ============================================================================
-- Clientes ativos em 30/10/2026 — clientes ativos em 30/10/2026
-- ============================================================================
do $limpeza$
declare
  v_org uuid;
  v_target record;
  v_tier text;
  v_linked uuid;
  v_client uuid;
  v_contract uuid;
  v_candidates integer;
  v_with_contract integer;
  v_kept uuid[] := '{}';
  v_contact jsonb;
  v_n integer;
  v_report text := '';
begin
  select id into v_org from public.organizations where slug = 'mugo' limit 1;
  if v_org is null then raise notice 'Organização mugo não encontrada; limpeza ignorada.'; return; end if;

  for v_target in
    select * from (values
      (1, 'Origami', array['["%origami%"]']::text[], 2500::numeric, 5::int,
        '[{"name":"Rodrigo Onias","phone":"+5511992000357","primary":true},{"name":"Sato","phone":"+5511951288644"}]'::jsonb),
      (2, 'Ruah', array['["%ruah%"]', '["%gimports%"]', '["%gabi%"]'], 7000, 5,
        '[{"name":"Gabi","phone":"+5582996107756","primary":true}]'::jsonb),
      (3, 'Roove', array['["%roove%"]'], 3200, 30,
        '[{"name":"Ana","phone":"+5511993161161","primary":true}]'::jsonb),
      (4, 'Rodrigo Mancusi', array['["%mancusi%"]'], 600, 10, null),
      (5, 'CAFIFA / Santo Circuito', array['["%cafifa%","%santo circuito%"]'], 2500, 10, null),
      (6, 'Curavino', array['["%curavino%"]'], 1300, 5,
        '[{"name":"Nasser","phone":"+5511971201557","primary":true},{"name":"Kaio","phone":"+5511983549025"}]'::jsonb),
      (7, 'Latinas', array['["%latina%"]'], 600, 20,
        '[{"name":"Elis","phone":"+34632881089","primary":true,"notes":"Espanha"},{"name":"Carele","phone":"+5511931462536"}]'::jsonb)
    ) as t(ord, label, tiers, monthly, billing_day, contacts) order by ord
  loop
    v_client := null;
    -- Tenta cada nível de nomes em ordem; só cai para o próximo se o anterior não achar nada.
    foreach v_tier in array v_target.tiers loop
      exit when v_client is not null;
      with patterns as (select jsonb_array_elements_text(v_tier::jsonb) p),
      cands as (
        select c.id, c.status, c.created_at,
          exists(select 1 from public.contracts k where k.client_id = c.id and k.status = 'active' and k.deleted_at is null) as has_contract
        from public.clients c
        where c.organization_id = v_org and c.deleted_at is null
          and exists(select 1 from patterns where c.company_name ilike p or coalesce(c.trade_name, '') ilike p)
      )
      select count(*), count(*) filter (where has_contract),
        (select id from cands order by has_contract desc, (status = 'active') desc, created_at asc limit 1)
      into v_candidates, v_with_contract, v_client from cands;
      if v_with_contract > 1 then
        raise exception 'Limpeza abortada: % tem % cadastros com contrato ativo. Unifique em Clientes > Duplicidades e rode de novo.', v_target.label, v_with_contract;
      end if;
    end loop;

    -- Ruah: respeita o vínculo já confirmado na conciliação, se existir.
    if v_target.ord = 2 then
      select (payload->>'linked_client_id')::uuid into v_linked
      from public.data_reconciliation_queue
      where organization_id = v_org and reconciliation_key = 'recurring:ruah' and status = 'resolved'
      limit 1;
      if v_linked is not null and exists(select 1 from public.clients where id = v_linked and organization_id = v_org and deleted_at is null) then
        v_client := v_linked;
      end if;
    end if;

    if v_client is null then
      insert into public.clients(organization_id, company_name, trade_name, status, notes)
      values (v_org, v_target.label, v_target.label, 'active', 'Criado na limpeza da carteira de 30/10/2026.')
      returning id into v_client;
      v_report := v_report || format(E'\n%s: cliente criado', v_target.label);
    else
      update public.clients set status = 'active', trade_name = coalesce(nullif(trim(trade_name), ''), v_target.label)
      where id = v_client and status is distinct from 'active';
      v_report := v_report || format(E'\n%s: cliente %s', v_target.label, v_client);
    end if;
    v_kept := v_kept || v_client;

    -- Contrato: o ativo com mensalidade mais recente; cria um se faltar e houver valor.
    select k.id into v_contract from public.contracts k
    where k.client_id = v_client and k.organization_id = v_org and k.status = 'active' and k.deleted_at is null
    order by (coalesce(k.monthly_value, 0) > 0) desc, k.start_date desc nulls last, k.created_at desc
    limit 1;

    if v_target.monthly is not null then
      if v_contract is null then
        insert into public.contracts(organization_id, client_id, status, start_date, monthly_value, billing_day, notes)
        values (v_org, v_client, 'active', date '2026-10-01', v_target.monthly, v_target.billing_day, 'Criado na limpeza da carteira de 30/10/2026.')
        returning id into v_contract;
        v_report := v_report || ' · contrato criado';
      else
        update public.contracts set monthly_value = v_target.monthly, billing_day = v_target.billing_day
        where id = v_contract and (monthly_value, billing_day) is distinct from (v_target.monthly, v_target.billing_day);
      end if;

      -- Parcelas mensais em aberto (sem recebimento) a partir de out/2026 passam para o valor atual.
      -- Vencimento no dia combinado (dia 30 vira o último dia em meses mais curtos).
      update public.invoice_installments i
        set amount = v_target.monthly, original_amount = v_target.monthly, currency = 'BRL', exchange_rate = 1,
          due_date = (i.reference_month + (least(v_target.billing_day, extract(day from (i.reference_month + interval '1 month' - interval '1 day'))::int) - 1))::date
      where i.organization_id = v_org and i.contract_id = v_contract
        and i.installment_type = 'monthly'
        and i.status in ('draft', 'pending', 'overdue')
        and coalesce(i.received_amount, 0) = 0 and i.paid_at is null
        and i.reference_month >= date '2026-10-01'
        and (i.amount is distinct from v_target.monthly or i.currency <> 'BRL'
          or i.due_date is distinct from (i.reference_month + (least(v_target.billing_day, extract(day from (i.reference_month + interval '1 month' - interval '1 day'))::int) - 1))::date)
        and not exists (select 1 from public.financial_month_closings f
          where f.organization_id = v_org and f.competence = i.reference_month and f.status = 'closed');
      get diagnostics v_n = row_count;
      v_report := v_report || format(' · R$ %s/mês, dia %s · %s parcela(s) ajustada(s)', v_target.monthly, v_target.billing_day, v_n);
    else
      v_report := v_report || ' · valor em aberto (sem alteração)';
    end if;

    -- Contatos informados substituem os antigos desse cliente.
    if v_target.contacts is not null then
      update public.client_contacts set is_primary = false where client_id = v_client and active and is_primary;
      update public.client_contacts set active = false
      where client_id = v_client and active
        and coalesce(public.normalize_phone_digits(phone), '') not in (
          select public.normalize_phone_digits(x->>'phone') from jsonb_array_elements(v_target.contacts) x);
      for v_contact in select * from jsonb_array_elements(v_target.contacts) loop
        update public.client_contacts set name = v_contact->>'name', phone = v_contact->>'phone',
          is_primary = coalesce((v_contact->>'primary')::boolean, false), notes = coalesce(v_contact->>'notes', notes)
        where client_id = v_client and active and public.normalize_phone_digits(phone) = public.normalize_phone_digits(v_contact->>'phone');
        if not found then
          insert into public.client_contacts(organization_id, client_id, name, phone, is_primary, notes, created_by)
          values (v_org, v_client, v_contact->>'name', v_contact->>'phone', coalesce((v_contact->>'primary')::boolean, false), v_contact->>'notes', null);
        end if;
      end loop;
      v_report := v_report || format(' · %s contato(s)', jsonb_array_length(v_target.contacts));
    end if;
  end loop;

  -- Quem estava como cliente ativo e não está na lista vira inativo. Nada é apagado:
  -- contratos ativos são encerrados e parcelas futuras sem recebimento são canceladas.
  -- Parcelas já vencidas continuam em aberto (podem ainda ser devidas).
  update public.invoice_installments i set status = 'cancelled', cancelled_at = now(),
    operational_notes = concat_ws(E'\n', nullif(i.operational_notes, ''), 'Cancelada na limpeza de 30/10/2026: cliente fora da carteira atual.')
  from public.clients c
  where c.id = i.client_id and c.organization_id = v_org and c.status = 'active' and c.deleted_at is null
    and not (c.id = any(v_kept))
    and i.status in ('draft', 'pending') and coalesce(i.received_amount, 0) = 0 and i.paid_at is null
    and i.due_date >= current_date
    and not exists (select 1 from public.financial_month_closings f
      where f.organization_id = v_org and f.competence = i.reference_month and f.status = 'closed');
  get diagnostics v_n = row_count;
  v_report := v_report || format(E'\nParcelas futuras canceladas de ex-clientes: %s', v_n);

  update public.contracts k set status = 'terminated', termination_date = current_date,
    termination_reason = 'Limpeza de 30/10/2026: cliente fora da carteira atual.'
  from public.clients c
  where c.id = k.client_id and c.organization_id = v_org and c.status = 'active' and c.deleted_at is null
    and not (c.id = any(v_kept)) and k.status = 'active' and k.deleted_at is null;
  get diagnostics v_n = row_count;
  v_report := v_report || format(E'\nContratos encerrados de ex-clientes: %s', v_n);

  update public.clients c set status = 'inactive'
  where c.organization_id = v_org and c.status = 'active' and c.deleted_at is null and not (c.id = any(v_kept));
  get diagnostics v_n = row_count;
  v_report := v_report || format(E'\nClientes marcados como inativos: %s', v_n);

  raise notice 'Limpeza da carteira 30/10/2026:%', v_report;
end
$limpeza$;

commit;
