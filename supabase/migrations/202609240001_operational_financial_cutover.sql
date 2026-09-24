-- Virada operacional/financeira da Mugô. Incremental, sem DELETE e sem apagar histórico.

alter table public.organization_settings
  add column if not exists operational_start_date date,
  add column if not exists financial_start_date date;

update public.organization_settings s
set operational_start_date=coalesce(s.operational_start_date,date '2026-09-24'),
    financial_start_date=coalesce(s.financial_start_date,date '2026-10-01')
from public.organizations o
where o.id=s.organization_id and o.slug='mugo';

alter table public.financial_monthly_plans
  add column if not exists opening_balance numeric(14,2);

comment on column public.organization_settings.operational_start_date is 'Data de corte visual da operação nova; registros anteriores permanecem históricos.';
comment on column public.organization_settings.financial_start_date is 'Primeira competência oficial do novo Financial Hub; histórico anterior permanece acessível.';
comment on column public.financial_monthly_plans.opening_balance is 'Saldo confirmado no início da competência. NULL significa ainda não informado.';

-- Atualiza somente datas de cobrança confirmadas. Valores e pagamentos permanecem intactos.
do $cutover_contracts$
declare v_org uuid;
begin
  select id into v_org from public.organizations where slug='mugo' limit 1;
  if v_org is null then return; end if;

  update public.contracts c set billing_day=5
  from public.clients cl
  where c.organization_id=v_org and c.client_id=cl.id and c.status='active'
    and (cl.company_name ilike '%origami%' or cl.trade_name ilike '%origami%')
    and c.billing_day is distinct from 5;

  update public.contracts c set billing_day=5
  from public.clients cl
  where c.organization_id=v_org and c.client_id=cl.id and c.status='active'
    and (cl.company_name ilike '%curavino%' or cl.trade_name ilike '%curavino%')
    and c.billing_day is distinct from 5;

  update public.contracts c set billing_day=25
  from public.clients cl
  where c.organization_id=v_org and c.client_id=cl.id and c.status='active'
    and (cl.company_name ilike '%roove%' or cl.trade_name ilike '%roove%')
    and c.billing_day is distinct from 25;

  update public.contracts c set billing_day=15
  from public.clients cl
  where c.organization_id=v_org and c.client_id=cl.id and c.status='active'
    and (cl.company_name ilike '%cafifa%' or cl.trade_name ilike '%cafifa%'
      or cl.company_name ilike '%santo circuito%' or cl.trade_name ilike '%santo circuito%')
    and c.billing_day is distinct from 15;

  -- Recalcula apenas parcelas abertas da nova operação. Histórico pago e competências anteriores ficam intactos.
  update public.invoice_installments i
  set due_date=(i.reference_month+(least(c.billing_day,extract(day from(i.reference_month+interval '1 month'-interval '1 day'))::int)-1)*interval '1 day')::date
  from public.contracts c
  where i.organization_id=v_org and i.contract_id=c.id
    and i.reference_month>=date '2026-10-01'
    and i.status in('draft','pending','overdue')
    and exists(
      select 1 from public.clients cl
      where cl.id=c.client_id and cl.organization_id=v_org
        and (cl.company_name ilike any(array['%origami%','%curavino%','%roove%','%cafifa%','%santo circuito%'])
          or cl.trade_name ilike any(array['%origami%','%curavino%','%roove%','%cafifa%','%santo circuito%']))
    );

  insert into public.data_reconciliation_queue(organization_id,reconciliation_key,entity_type,external_name,payload,notes)
  select
    v_org,'contract-review:cafifa-end-date','contract_review','CAFIFA / Santo Circuito',
    jsonb_build_object('reason','missing_end_date','billing_day',15,'requires_admin_confirmation',true),
    'Contrato ativo sem data final. Preservar contrato e parcelas; revisar administrativamente sem gerar extensão automática.'
  where exists(
    select 1 from public.contracts c join public.clients cl on cl.id=c.client_id
    where c.organization_id=v_org and c.status='active' and c.end_date is null
      and (cl.company_name ilike '%cafifa%' or cl.trade_name ilike '%cafifa%'
        or cl.company_name ilike '%santo circuito%' or cl.trade_name ilike '%santo circuito%')
  )
  on conflict(organization_id,reconciliation_key) do update
    set payload=public.data_reconciliation_queue.payload||excluded.payload,
        notes=excluded.notes,updated_at=now();

  update public.data_reconciliation_queue
  set payload=payload||jsonb_build_object(
        'billing_day',5,
        'candidate_client_name','GIMPORTS SPLITS',
        'requires_admin_confirmation',true,
        'administrative_action','link_ruah_to_existing_gimports'
      ),
      notes='Possível vínculo com GIMPORTS SPLITS. Não vincular nem alterar contrato sem confirmação administrativa.',
      updated_at=now()
  where organization_id=v_org and reconciliation_key='recurring:ruah' and status='pending_mapping';

  update public.data_reconciliation_queue
  set payload=payload||jsonb_build_object(
        'billing_day',10,'currency','EUR','original_amount',100,
        'exchange_rate',null,'projected_brl_amount',null,'actual_brl_amount',null,
        'requires_admin_confirmation',true
      ),
      notes='Preservar EUR 100. Vincular somente com evidência; não criar BRL sem taxa real.',
      updated_at=now()
  where organization_id=v_org and reconciliation_key='recurring:latina' and status='pending_mapping';
end
$cutover_contracts$;

-- Ação explícita e administrativa. Não cria cliente/contrato e nunca escolhe candidato sozinho.
create or replace function public.link_ruah_to_existing_gimports(p_client_id uuid,p_contract_id uuid)
returns public.data_reconciliation_queue
language plpgsql
security definer
set search_path=''
as $$
declare
  org uuid:=public.current_organization_id();
  queue_row public.data_reconciliation_queue%rowtype;
  v_billing_day constant integer:=5;
  v_cutover date;
begin
  if org is null or not public.is_admin() then
    raise exception 'Somente administrador ativo pode confirmar o vínculo da Ruah.';
  end if;

  select * into queue_row from public.data_reconciliation_queue
  where organization_id=org and reconciliation_key='recurring:ruah'
  for update;
  if not found then
    raise exception 'Reconciliação pendente da Ruah não encontrada.';
  end if;

  -- Idempotência estrita: repetir a confirmação com os mesmos IDs devolve a linha já resolvida sem reexecutar nada.
  if queue_row.status='resolved' then
    if (queue_row.payload->>'linked_client_id')::uuid=p_client_id
      and (queue_row.payload->>'linked_contract_id')::uuid=p_contract_id then
      return queue_row;
    end if;
    raise exception 'A Ruah já foi vinculada a outro cliente ou contrato.';
  end if;

  if queue_row.status<>'pending_mapping' then
    raise exception 'Reconciliação pendente da Ruah não encontrada.';
  end if;

  if not exists(
    select 1 from public.clients
    where id=p_client_id and organization_id=org
      and (company_name ilike '%gimports%' or trade_name ilike '%gimports%')
  ) then raise exception 'O cliente confirmado não corresponde a GIMPORTS SPLITS.'; end if;

  if not exists(
    select 1 from public.contracts
    where id=p_contract_id and organization_id=org and client_id=p_client_id and status='active'
  ) then raise exception 'Contrato ativo do cliente confirmado não encontrado.'; end if;

  select s.financial_start_date into v_cutover from public.organization_settings s where s.organization_id=org;
  if v_cutover is null then
    if exists(select 1 from public.organizations where id=org and slug='mugo') then
      v_cutover:=date '2026-10-01';
    else
      raise exception 'Data de início financeiro não configurada para esta organização.';
    end if;
  end if;

  update public.contracts set billing_day=v_billing_day where id=p_contract_id and organization_id=org;

  -- Recalcula somente parcelas abertas e futuras da nova operação neste contrato; histórico, pagas,
  -- com recebimento e competências fechadas permanecem intactos.
  update public.invoice_installments i
  set due_date=(i.reference_month+(least(v_billing_day,extract(day from(i.reference_month+interval '1 month'-interval '1 day'))::int)-1)*interval '1 day')::date,
      updated_at=now()
  where i.organization_id=org
    and i.contract_id=p_contract_id
    and i.reference_month>=v_cutover
    and i.status in('draft','pending','overdue')
    and coalesce(i.received_amount,0)=0
    and i.paid_at is null
    and not exists(
      select 1 from public.financial_month_closings closing
      where closing.organization_id=org
        and closing.competence=date_trunc('month',i.reference_month)::date
        and closing.status='closed'
    );

  update public.data_reconciliation_queue
  set status='resolved',linked_record_id=p_client_id,
      payload=payload||jsonb_build_object('linked_client_id',p_client_id,'linked_contract_id',p_contract_id,'resolved_at',now()),
      notes='Vínculo Ruah → GIMPORTS SPLITS confirmado explicitamente por administrador.',updated_at=now()
  where id=queue_row.id returning * into queue_row;
  return queue_row;
end
$$;
revoke all on function public.link_ruah_to_existing_gimports(uuid,uuid) from public,anon,authenticated;
grant execute on function public.link_ruah_to_existing_gimports(uuid,uuid) to authenticated;

-- Operação idempotente: somente pendentes sem qualquer recebimento viram vencidos.
create or replace function public.refresh_overdue_receivables()
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare org uuid:=public.current_organization_id(); changed integer:=0;
begin
  if org is null or not public.has_financial_permission('finance.view_business') then
    raise exception 'Organização ativa e permissão financeira são obrigatórias.';
  end if;
  update public.invoice_installments
  set status='overdue',updated_at=now()
  where organization_id=org and status='pending' and due_date<current_date
    and coalesce(received_amount,0)=0 and paid_at is null
    and not exists(
      select 1 from public.financial_month_closings closing
      where closing.organization_id=org
        and closing.competence=date_trunc('month',public.invoice_installments.reference_month)::date
        and closing.status='closed'
    );
  get diagnostics changed=row_count;
  return changed;
end
$$;
revoke all on function public.refresh_overdue_receivables() from public,anon;
grant execute on function public.refresh_overdue_receivables() to authenticated;

-- Dry run nunca pode produzir um relatório vazio por falta de contexto de tenant.
create or replace function public.crm_cleanup_dry_run()
returns table(table_name text,before_count bigint,preserved_count bigint,removable_count bigint,created_count bigint,rule text)
language plpgsql stable security definer set search_path='' as $$
declare org uuid:=public.current_organization_id();
begin
  if org is null then raise exception 'Nenhuma organização ativa encontrada. Dry run cancelado.'; end if;
  if not public.is_admin() then raise exception 'Apenas administradores podem gerar o dry-run de limpeza.'; end if;
  return query select 'clients',count(*)::bigint,count(*)::bigint,0::bigint,0::bigint,'Todos os clientes com nome ou telefone útil são preservados.' from public.clients where organization_id=org;
  return query select 'crm_tasks',count(*)::bigint,count(*) filter(where not(coalesce(source,'') in('demo','test','seed') or title~* '\m(demo|teste|exemplo|mock)\M'))::bigint,count(*) filter(where coalesce(source,'') in('demo','test','seed') or title~* '\m(demo|teste|exemplo|mock)\M')::bigint,0::bigint,'Somente marcadores explícitos de demo/teste são candidatos.' from public.crm_tasks where organization_id=org;
  return query select 'proposals',count(*)::bigint,count(*) filter(where not(title~* '\m(demo|teste|exemplo|mock)\M' and not exists(select 1 from public.contracts c where c.proposal_id=p.id) and not exists(select 1 from public.documents d where d.proposal_id=p.id)))::bigint,count(*) filter(where title~* '\m(demo|teste|exemplo|mock)\M' and not exists(select 1 from public.contracts c where c.proposal_id=p.id) and not exists(select 1 from public.documents d where d.proposal_id=p.id))::bigint,0::bigint,'Propostas só são candidatas quando explicitamente de teste e sem contrato/documento.' from public.proposals p where organization_id=org;
  return query select 'contracts',count(*)::bigint,count(*)::bigint,0::bigint,0::bigint,'Contratos não são removidos automaticamente.' from public.contracts where organization_id=org;
  return query select 'invoice_installments',count(*)::bigint,count(*)::bigint,0::bigint,0::bigint,'Parcelas e recebimentos não são removidos automaticamente.' from public.invoice_installments where organization_id=org;
  return query select 'expenses',count(*)::bigint,count(*) filter(where not(name~* '\m(demo|teste|exemplo|mock)\M' and not exists(select 1 from public.expense_installments ei where ei.expense_id=e.id and(ei.status='paid' or ei.paid_amount>0))))::bigint,count(*) filter(where name~* '\m(demo|teste|exemplo|mock)\M' and not exists(select 1 from public.expense_installments ei where ei.expense_id=e.id and(ei.status='paid' or ei.paid_amount>0)))::bigint,0::bigint,'Despesas pagas nunca são candidatas; apenas registros explicitamente de teste.' from public.expenses e where organization_id=org;
end$$;

create or replace function public.capture_crm_cleanup_dry_run()
returns uuid language plpgsql security definer set search_path='' as $$
declare org uuid:=public.current_organization_id();snapshot_id uuid;payload jsonb;
begin
  if org is null then raise exception 'Nenhuma organização ativa encontrada. Dry run cancelado.'; end if;
  if not public.is_admin() then raise exception 'Apenas administradores podem capturar o dry-run de limpeza.'; end if;
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into payload from public.crm_cleanup_dry_run() r;
  insert into public.crm_cleanup_snapshots(organization_id,mode,report,created_by)
  values(org,'dry_run',payload,auth.uid()) returning id into snapshot_id;
  return snapshot_id;
end$$;

revoke all on function public.crm_cleanup_dry_run(),public.capture_crm_cleanup_dry_run() from public,anon;
grant execute on function public.crm_cleanup_dry_run(),public.capture_crm_cleanup_dry_run() to authenticated;

comment on function public.refresh_overdue_receivables() is 'Marca como overdue apenas parcelas pendentes, vencidas e sem recebimento; execução idempotente.';
comment on function public.link_ruah_to_existing_gimports(uuid,uuid) is 'Reconciliação administrativa explícita; nunca cria ou escolhe cliente/contrato automaticamente. Recalcula due_date apenas das parcelas abertas e futuras do contrato vinculado, na mesma transação.';
