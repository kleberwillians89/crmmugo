-- Pós-validação READ ONLY do corte financeiro Mugô.
-- Este arquivo contém uma única consulta e não modifica dados.

with
params as (
  select
    '1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f'::uuid as organization_id,
    date '2026-10-01' as first_month,
    date '2027-02-01' as last_month
),
official(
  official_name,name_pattern,expected_currency,expected_amount,billing_day,
  expected_due_date,expected_client_id,expected_contract_id,minimum_end_date
) as (
  -- minimum_end_date: recorrência oficial deste corte vai até fevereiro/2027 para os 5 clientes —
  -- não só Roove. Contrato com end_date nulo (em aberto, ex.: Curavino) também satisfaz a checagem.
  values
    ('Origami','%origami%','BRL',3500::numeric,5,date '2026-10-05',null::uuid,null::uuid,date '2027-02-28'),
    ('Curavino','%curavino%','BRL',1300::numeric,5,date '2026-10-05',null::uuid,null::uuid,date '2027-02-28'),
    ('GIMPORTS','%gimports%','BRL',7000::numeric,10,date '2026-10-10',null::uuid,null::uuid,date '2027-02-28'),
    ('Latina','%latina%','EUR',100::numeric,10,date '2026-10-10',null::uuid,null::uuid,date '2027-02-28'),
    ('Roove','%roove%','BRL',3200::numeric,25,date '2026-10-25',
      'e7919cd3-c989-49c9-994f-eb31aa9ce294'::uuid,
      '3b56bcde-99b5-4244-9a5d-e0535339a59f'::uuid,date '2027-02-28')
),
resolved as (
  select
    o.*,
    client_match.match_count as client_count,
    client_match.client_id,
    client_match.company_name,
    client_match.client_status,
    contract_match.match_count as contract_count,
    contract_match.contract_id,
    contract_match.monthly_value,
    contract_match.current_billing_day,
    contract_match.start_date,
    contract_match.end_date,
    october_match.match_count as october_count,
    october_match.installment_id as october_installment_id,
    october_match.current_currency,
    october_match.current_amount,
    october_match.current_due_date,
    october_match.current_status
  from official o
  cross join params p
  left join lateral (
    select
      count(*)::integer as match_count,
      (array_agg(c.id order by c.id))[1] as client_id,
      min(c.company_name) as company_name,
      min(c.status) as client_status
    from public.clients c
    where c.organization_id=p.organization_id
      and c.deleted_at is null
      and c.status<>'archived'
      and (
        (o.expected_client_id is not null and c.id=o.expected_client_id)
        or (
          o.expected_client_id is null
          and (c.company_name ilike o.name_pattern or c.trade_name ilike o.name_pattern)
        )
      )
  ) client_match on true
  left join lateral (
    select
      count(*)::integer as match_count,
      (array_agg(c.id order by c.id))[1] as contract_id,
      min(c.monthly_value) as monthly_value,
      min(c.billing_day) as current_billing_day,
      min(c.start_date) as start_date,
      min(c.end_date) as end_date
    from public.contracts c
    where c.organization_id=p.organization_id
      and c.client_id=client_match.client_id
      and c.status='active'
      and c.deleted_at is null
      and (o.expected_contract_id is null or c.id=o.expected_contract_id)
  ) contract_match on true
  left join lateral (
    select
      count(*)::integer as match_count,
      (array_agg(i.id order by i.id))[1] as installment_id,
      min(i.currency) as current_currency,
      min(case when i.currency='EUR' then coalesce(i.original_amount,i.amount) else i.amount end) as current_amount,
      min(i.due_date) as current_due_date,
      min(i.status) as current_status
    from public.invoice_installments i
    where i.organization_id=p.organization_id
      and i.contract_id=contract_match.contract_id
      and i.reference_month=date '2026-10-01'
      and coalesce(i.installment_type,'monthly')='monthly'
  ) october_match on true
),
official_installments as (
  select i.*,r.official_name
  from public.invoice_installments i
  join resolved r on r.contract_id=i.contract_id and r.client_id=i.client_id
  cross join params p
  where i.organization_id=p.organization_id
    and i.reference_month between p.first_month and p.last_month
    and coalesce(i.installment_type,'monthly')='monthly'
),
duplicate_months as (
  select contract_id,reference_month,count(*) as duplicate_count
  from official_installments
  group by contract_id,reference_month
  having count(*)>1
),
monthly_totals as (
  select
    reference_month,
    coalesce(sum(amount) filter(where currency='BRL' and status<>'cancelled'),0) as brl_total,
    coalesce(sum(coalesce(original_amount,amount)) filter(where currency='EUR' and status<>'cancelled'),0) as eur_total
  from official_installments
  group by reference_month
),
cafifa_santo as (
  select c.id,c.organization_id
  from public.clients c
  cross join params p
  where c.organization_id=p.organization_id
    and (
      c.company_name ilike any(array['%cafifa%','%santo circuito%'])
      or c.trade_name ilike any(array['%cafifa%','%santo circuito%'])
    )
),
expense_expected(name,expected_amount) as (
  values
    ('Liliu',1800::numeric),
    ('ChatGPT',130::numeric),
    ('Claude',120::numeric),
    ('Canva',30::numeric)
),
expense_state as (
  select
    x.name,
    x.expected_amount,
    expense_match.match_count,
    expense_match.current_amount
  from expense_expected x
  cross join params p
  left join lateral (
    select count(*)::integer as match_count,min(e.total_amount) as current_amount
    from public.expenses e
    where e.organization_id=p.organization_id
      and e.deleted_at is null
      and e.status<>'cancelled'
      and e.recurrence_type='monthly'
      and e.financial_scope='business'
      and lower(e.name)=lower(x.name)
  ) expense_match on true
),
checks(ordinal,check_name,passed,expected,actual,detail) as (
  select
    10,
    'OFFICIAL_ACTIVE_CONTRACTS',
    count(*) filter(where client_count=1 and contract_count=1)=5
      and coalesce(sum(contract_count),0)=5,
    'Exatamente 5 contratos oficiais ativos, um para cada recorrente',
    jsonb_build_object(
      'resolved_officials',count(*) filter(where client_count=1 and contract_count=1),
      'active_contract_matches',coalesce(sum(contract_count),0)
    )::text,
    'Origami, Curavino, GIMPORTS, Latina e Roove.'
  from resolved

  union all
  select
    20,
    'CAFIFA_SANTO_NO_ACTIVE_CONTRACT',
    count(*)=0,
    '0 contratos ativos',
    count(*)::text,
    'CAFIFA/Santo Circuito não integra a recorrência oficial.'
  from public.contracts c
  join cafifa_santo removed on removed.id=c.client_id and removed.organization_id=c.organization_id
  where c.status='active' and c.deleted_at is null

  union all
  select
    21,
    'CAFIFA_SANTO_NO_ACTIONABLE_FUTURE_INSTALLMENT',
    count(*)=0,
    '0 parcelas futuras pending/overdue',
    count(*)::text,
    'Parcelas canceladas permanecem apenas como histórico.'
  from public.invoice_installments i
  join cafifa_santo removed on removed.id=i.client_id and removed.organization_id=i.organization_id
  cross join params p
  where (i.reference_month>=p.first_month or i.due_date>=p.first_month)
    and i.status in('pending','overdue')

  union all
  select
    30+row_number() over(order by array_position(array['Origami','Curavino','GIMPORTS','Latina','Roove'],official_name))::integer,
    upper(official_name)||'_OFFICIAL_CONFIGURATION',
    client_count=1
      and contract_count=1
      and current_billing_day=billing_day
      and october_count=1
      and current_currency=expected_currency
      and current_amount=expected_amount
      and current_due_date=expected_due_date
      and current_status<>'cancelled'
      and (end_date is null or end_date>=minimum_end_date)
      and (official_name<>'Roove' or (
        client_id='e7919cd3-c989-49c9-994f-eb31aa9ce294'::uuid
        and contract_id='3b56bcde-99b5-4244-9a5d-e0535339a59f'::uuid
        and monthly_value=3200
      )),
    jsonb_build_object(
      'currency',expected_currency,'amount',expected_amount,'billing_day',billing_day,
      'next_due_date',expected_due_date,
      'client_id',case when official_name='Roove' then expected_client_id else null end,
      'contract_id',case when official_name='Roove' then expected_contract_id else null end,
      'minimum_end_date',minimum_end_date
    )::text,
    jsonb_build_object(
      'client_count',client_count,'contract_count',contract_count,'client_id',client_id,
      'contract_id',contract_id,'contract_monthly_value',monthly_value,
      'billing_day',current_billing_day,'end_date',end_date,'october_count',october_count,
      'currency',current_currency,'amount',current_amount,'due_date',current_due_date,
      'status',current_status
    )::text,
    'Configuração do contrato e da mensalidade de Outubro/2026.'
  from resolved

  union all
  select
    40,
    'NO_FINANCIAL_INSTALLMENT_FOR_ROOVE_TEST_LEAD',
    count(*)=0,
    '0 parcelas para a0ce7df3-a9bd-458f-83cf-f6b0a8b9271c',
    count(*)::text,
    'O lead de homologação nunca pode participar do financeiro.'
  from public.invoice_installments i
  cross join params p
  where i.organization_id=p.organization_id
    and i.client_id='a0ce7df3-a9bd-458f-83cf-f6b0a8b9271c'::uuid

  union all
  select
    50,
    'OFFICIAL_FUTURE_INSTALLMENT_COUNT',
    count(*)=25,
    '25 parcelas mensais entre 2026-10-01 e 2027-02-01',
    count(*)::text,
    'Cinco clientes multiplicados por cinco competências.'
  from official_installments

  union all
  select
    60,
    'NO_OFFICIAL_INSTALLMENT_DUPLICATES',
    count(*)=0,
    '0 duplicidades por organization_id + contract_id + reference_month',
    count(*)::text,
    coalesce(jsonb_agg(jsonb_build_object(
      'contract_id',contract_id,'reference_month',reference_month,'count',duplicate_count
    ))::text,'[]')
  from duplicate_months

  union all
  select
    70,
    'OFFICIAL_MONTHLY_BRL_TOTAL',
    count(*)=5 and bool_and(brl_total=15000),
    'BRL 15000 em cada uma das 5 competências',
    coalesce(jsonb_agg(jsonb_build_object('reference_month',reference_month,'BRL',brl_total) order by reference_month)::text,'[]'),
    'Receita EUR não é convertida nem somada ao BRL.'
  from monthly_totals

  union all
  select
    71,
    'OFFICIAL_MONTHLY_EUR_TOTAL',
    count(*)=5 and bool_and(eur_total=100),
    'EUR 100 em cada uma das 5 competências',
    coalesce(jsonb_agg(jsonb_build_object('reference_month',reference_month,'EUR',eur_total) order by reference_month)::text,'[]'),
    'Latina permanece em moeda original.'
  from monthly_totals

  union all
  select
    80,
    'SEPTEMBER_NO_ACTIONABLE_OFFICIAL_INSTALLMENT',
    count(*)=0,
    '0 parcelas oficiais de Setembro pending/overdue',
    count(*)::text,
    'Setembro já foi recebido e não pode voltar para a fila de cobrança.'
  from public.invoice_installments i
  join resolved r on r.contract_id=i.contract_id and r.client_id=i.client_id
  cross join params p
  where i.organization_id=p.organization_id
    and i.reference_month=date '2026-09-01'
    and coalesce(i.installment_type,'monthly')='monthly'
    and i.status in('pending','overdue')

  union all
  select
    90,
    'ROOVE_HISTORICAL_INSTALLMENT_PRESERVED',
    count(*)=1
      and bool_and(status='paid' and amount=2300 and received_amount=2300),
    'paid; amount 2300; received_amount 2300',
    coalesce(jsonb_agg(jsonb_build_object(
      'id',id,'status',status,'amount',amount,'received_amount',received_amount,'paid_at',paid_at
    ))::text,'[]'),
    'A linha histórica divergente deve permanecer exatamente preservada.'
  from public.invoice_installments i
  cross join params p
  where i.organization_id=p.organization_id
    and i.id='26a6ae5c-e9db-4863-8e55-6ae85a756bbc'::uuid

  union all
  select
    91,
    'ROOVE_OCTOBER_INSTALLMENT_PRESERVED',
    count(*)=1 and bool_and(amount=3200 and due_date=date '2026-10-25'),
    'amount 3200; due_date 2026-10-25',
    coalesce(jsonb_agg(jsonb_build_object(
      'id',id,'amount',amount,'due_date',due_date,'status',status
    ))::text,'[]'),
    'Parcela oficial de Outubro da Roove.'
  from public.invoice_installments i
  cross join params p
  where i.organization_id=p.organization_id
    and i.id='55c0df24-3449-4be5-bc04-8b59b630c693'::uuid

  union all
  select
    100,
    'BUSINESS_RECURRING_EXPENSES',
    count(*)=4
      and bool_and(match_count=1 and current_amount=expected_amount)
      and sum(current_amount)=2080,
    'Liliu 1800; ChatGPT 130; Claude 120; Canva 30; total 2080',
    jsonb_build_object(
      'total',coalesce(sum(current_amount),0),
      'items',jsonb_agg(jsonb_build_object(
        'name',name,'expected',expected_amount,'actual',current_amount,'matches',match_count
      ) order by name)
    )::text,
    'Somente despesas empresariais mensais não canceladas.'
  from expense_state

  union all
  select
    110,
    'FISCAL_PROVISION_NOT_ACTIVE',
    count(*)=0,
    '0 provisões fiscais de 1500 ativas em Outubro/2026',
    count(*)::text,
    'Provisão fiscal encerrada não integra despesas ativas.'
  from public.expenses e
  cross join params p
  where e.organization_id=p.organization_id
    and e.deleted_at is null
    and e.total_amount=1500
    and (e.name ilike '%provisão fiscal%' or e.source_ref='notion:despesa:provisao-fiscal-2026-09')
    and e.status<>'cancelled'
    and (e.end_date is null or e.end_date>=p.first_month)

  union all
  select
    120,
    'OCTOBER_OPENING_BALANCE_UNINFORMED',
    count(*) filter(where plan.opening_balance is not null)=0,
    'NULL ou linha inexistente',
    coalesce(jsonb_agg(jsonb_build_object(
      'plan_id',plan.id,'opening_balance',plan.opening_balance
    )) filter(where plan.id is not null)::text,'[]'),
    'Saldo inicial não pode ser presumido como zero.'
  from params p
  left join public.financial_monthly_plans plan
    on plan.organization_id=p.organization_id
    and plan.competence=p.first_month
    and plan.scope='business'

  union all
  select
    130,
    'NO_FUTURE_FINANCIAL_RECORD_FOR_ARCHIVED_OR_TEST_LEAD',
    count(*)=0,
    '0 parcelas futuras ligadas a clientes arquivados ou ao lead de homologação',
    count(*)::text,
    coalesce(jsonb_agg(jsonb_build_object(
      'installment_id',i.id,'client_id',i.client_id,'reference_month',i.reference_month,'status',i.status
    ))::text,'[]')
  from public.invoice_installments i
  join public.clients c on c.id=i.client_id and c.organization_id=i.organization_id
  cross join params p
  where i.organization_id=p.organization_id
    and i.reference_month>=p.first_month
    and (c.status='archived' or c.id='a0ce7df3-a9bd-458f-83cf-f6b0a8b9271c'::uuid)
),
final_check as (
  select
    999 as ordinal,
    'FINAL_GO_LIVE_CHECK'::text as check_name,
    coalesce(bool_and(coalesce(passed,false)),false) as passed,
    'Todas as verificações críticas em PASS'::text as expected,
    count(*) filter(where passed)::text||'/'||count(*)::text||' checks em PASS' as actual,
    case
      when coalesce(bool_and(coalesce(passed,false)),false) then 'Corte financeiro validado para go-live.'
      else 'Go-live bloqueado: revisar os checks em FAIL antes de prosseguir.'
    end as detail
  from checks
)
select
  check_name as "CHECK_NAME",
  case when passed then 'PASS' else 'FAIL' end as "STATUS",
  expected as "EXPECTED",
  actual as "ACTUAL",
  detail as "DETAIL"
from (
  select * from checks
  union all
  select * from final_check
) result
order by ordinal;
