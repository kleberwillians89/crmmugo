-- Preparação nativa para uso diário. Não importa dados externos e não executa limpeza.

-- Integrações operacionais legadas permanecem apenas para auditoria histórica.
update public.task_integration_settings
set enabled=false,last_error=null,updated_at=now()
where provider in('trello','notion');

update public.task_sync_outbox
set status='dead_letter',processed_at=now(),last_error='Integração externa desativada por decisão de produto.'
where provider in('trello','notion') and status in('pending','processing','failed');

update public.commercial_briefing_outbox
set status='dead_letter',processed_at=now(),last_error='Briefing externo desativado por decisão de produto.'
where provider='notion' and status in('pending','processing','failed');

drop trigger if exists enqueue_task_sync on public.crm_tasks;
create or replace function public.enqueue_task_sync() returns trigger language plpgsql set search_path='' as $$
begin
  return new;
end$$;

update public.commercial_settings set ai_mode='disabled',updated_at=now() where ai_mode<>'disabled';

create table if not exists public.operational_settings(
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  weekly_target_hours numeric(6,2) not null default 35 check(weekly_target_hours between 0 and 168),
  time_zone text not null default 'America/Sao_Paulo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.operational_settings(organization_id,weekly_target_hours,time_zone)
select id,35,'America/Sao_Paulo' from public.organizations on conflict(organization_id) do nothing;
alter table public.operational_settings enable row level security;
alter table public.operational_settings force row level security;
drop policy if exists operational_settings_read on public.operational_settings;
drop policy if exists operational_settings_manage on public.operational_settings;
create policy operational_settings_read on public.operational_settings for select to authenticated
  using(organization_id=public.current_organization_id() and public.can_operate());
create policy operational_settings_manage on public.operational_settings for all to authenticated
  using(organization_id=public.current_organization_id() and public.current_user_role() in('admin','manager'))
  with check(organization_id=public.current_organization_id() and public.current_user_role() in('admin','manager'));
grant select on public.operational_settings to authenticated;
grant insert,update,delete on public.operational_settings to authenticated;
grant all on public.operational_settings to service_role;
drop trigger if exists set_updated_at on public.operational_settings;
create trigger set_updated_at before update on public.operational_settings for each row execute function public.set_updated_at();

create table if not exists public.access_role_presets(
  organization_id uuid not null references public.organizations(id) on delete cascade,
  preset_key text not null,
  role_key text not null,
  label text not null,
  allowed_capabilities text[] not null default '{}',
  denied_capabilities text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(organization_id,preset_key)
);
insert into public.access_role_presets(organization_id,preset_key,role_key,label,allowed_capabilities,denied_capabilities)
select id,'operator','operations','Operador',
  array['operations.today','operations.week','operations.calendar','tasks.read','tasks.write','activities.write','clients.assigned','whatsapp.assigned','finance.create_expense_request'],
  array['finance.view_household','finance.view_private','finance.view_debts','finance.view_reserves','finance.view_accounts','finance.view_distribution','settings.manage','users.manage','admin.access']
from public.organizations
on conflict(organization_id,preset_key) do update set role_key=excluded.role_key,label=excluded.label,allowed_capabilities=excluded.allowed_capabilities,denied_capabilities=excluded.denied_capabilities,updated_at=now();
alter table public.access_role_presets enable row level security;
alter table public.access_role_presets force row level security;
drop policy if exists access_role_presets_admin on public.access_role_presets;
create policy access_role_presets_admin on public.access_role_presets for all to authenticated
  using(organization_id=public.current_organization_id() and public.is_admin())
  with check(organization_id=public.current_organization_id() and public.is_admin());
grant select,insert,update,delete on public.access_role_presets to authenticated;
grant all on public.access_role_presets to service_role;
drop trigger if exists set_updated_at on public.access_role_presets;
create trigger set_updated_at before update on public.access_role_presets for each row execute function public.set_updated_at();

create table if not exists public.data_reconciliation_queue(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  reconciliation_key text not null,
  entity_type text not null,
  external_name text not null,
  status text not null default 'pending_mapping' check(status in('pending_mapping','resolved','skipped')),
  payload jsonb not null default '{}'::jsonb,
  linked_record_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,reconciliation_key)
);
alter table public.data_reconciliation_queue enable row level security;
alter table public.data_reconciliation_queue force row level security;
drop policy if exists data_reconciliation_queue_read on public.data_reconciliation_queue;
drop policy if exists data_reconciliation_queue_write on public.data_reconciliation_queue;
create policy data_reconciliation_queue_read on public.data_reconciliation_queue for select to authenticated
  using(organization_id=public.current_organization_id() and public.current_user_role() in('admin','manager','finance'));
create policy data_reconciliation_queue_write on public.data_reconciliation_queue for all to authenticated
  using(organization_id=public.current_organization_id() and public.current_user_role() in('admin','manager','finance'))
  with check(organization_id=public.current_organization_id() and public.current_user_role() in('admin','manager','finance'));
grant select,insert,update on public.data_reconciliation_queue to authenticated;
grant all on public.data_reconciliation_queue to service_role;
drop trigger if exists set_updated_at on public.data_reconciliation_queue;
create trigger set_updated_at before update on public.data_reconciliation_queue for each row execute function public.set_updated_at();

create or replace function public.protect_closed_financial_period()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  new_row jsonb;
  old_row jsonb;
  org uuid;
  v_competence date;
begin
  new_row :=
    case
      when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new)
      else '{}'::jsonb
    end;

  old_row :=
    case
      when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old)
      else '{}'::jsonb
    end;

  org := coalesce(
    nullif(new_row ->> 'organization_id', '')::uuid,
    nullif(old_row ->> 'organization_id', '')::uuid
  );

  v_competence :=
    case tg_table_name
      when 'invoice_installments' then
        date_trunc(
          'month',
          coalesce(
            nullif(new_row ->> 'reference_month', '')::date,
            nullif(old_row ->> 'reference_month', '')::date
          )
        )::date

      when 'expense_installments' then
        date_trunc(
          'month',
          coalesce(
            nullif(new_row ->> 'reference_month', '')::date,
            nullif(old_row ->> 'reference_month', '')::date
          )
        )::date

      when 'debt_payments' then
        coalesce(
          nullif(new_row ->> 'competence', '')::date,
          nullif(old_row ->> 'competence', '')::date
        )

      when 'freelance_cash_movements' then
        coalesce(
          nullif(new_row ->> 'competence', '')::date,
          nullif(old_row ->> 'competence', '')::date
        )

      when 'financial_goal_movements' then
        coalesce(
          nullif(new_row ->> 'competence', '')::date,
          nullif(old_row ->> 'competence', '')::date
        )

      else null
    end;

  if org is not null
     and v_competence is not null
     and exists (
       select 1
       from public.financial_month_closings
       where organization_id = org
         and competence = v_competence
         and status = 'closed'
     )
  then
    raise exception
      'Competência fechada. Reabra com permissão elevada e justificativa.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end
$$;

do $native_recurring$
declare v_org uuid;
begin
  select id into v_org from public.organizations where slug='mugo' limit 1;
  if v_org is null then return;end if;

  -- Somente dias confirmados são alterados. Valores contratuais existentes permanecem intactos.
  update public.contracts c set billing_day=5
    from public.clients cl where c.organization_id=v_org and c.client_id=cl.id and c.status='active'
      and (cl.company_name ilike '%origami%' or cl.trade_name ilike '%origami%');
  update public.contracts c set billing_day=5
    from public.clients cl where c.organization_id=v_org and c.client_id=cl.id and c.status='active'
      and (cl.company_name ilike '%curavino%' or cl.trade_name ilike '%curavino%');
  update public.contracts c set billing_day=25
    from public.clients cl where c.organization_id=v_org and c.client_id=cl.id and c.status='active'
      and (cl.company_name ilike '%roove%' or cl.trade_name ilike '%roove%');

  update public.invoice_installments i
  set due_date=(i.reference_month+(least(c.billing_day,extract(day from(i.reference_month+interval '1 month'-interval '1 day'))::int)-1)*interval '1 day')::date
  from public.contracts c
  where i.organization_id=v_org and i.contract_id=c.id and i.status in('draft','pending','overdue')
    and exists(select 1 from public.clients cl where cl.id=c.client_id and cl.organization_id=v_org
      and (cl.company_name ilike any(array['%origami%','%curavino%','%roove%']) or cl.trade_name ilike any(array['%origami%','%curavino%','%roove%'])));

  -- Sem cliente/contrato inequívoco não há criação automática nem valor inventado.
  insert into public.data_reconciliation_queue(organization_id,reconciliation_key,entity_type,external_name,payload,notes)
  values
    (v_org,'recurring:ruah','recurring_receivable','Ruah',jsonb_build_object('billing_day',5),'Vincular a cliente e contrato reais antes de gerar parcelas.'),
    (v_org,'recurring:latina','recurring_receivable','Latina',jsonb_build_object('billing_day',10,'currency','EUR','original_amount',100,'exchange_rate',null,'projected_brl_amount',null,'actual_brl_amount',null),'Preservar EUR 100; informar câmbio apenas quando houver referência real.')
  on conflict(organization_id,reconciliation_key) do update set payload=excluded.payload,notes=excluded.notes,status='pending_mapping',updated_at=now();
end
$native_recurring$;

create table if not exists public.crm_cleanup_snapshots(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  mode text not null default 'dry_run' check(mode='dry_run'),
  report jsonb not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.crm_cleanup_snapshots enable row level security;
alter table public.crm_cleanup_snapshots force row level security;
drop policy if exists crm_cleanup_snapshots_admin on public.crm_cleanup_snapshots;
create policy crm_cleanup_snapshots_admin on public.crm_cleanup_snapshots for select to authenticated
  using(organization_id=public.current_organization_id() and public.is_admin());
grant select on public.crm_cleanup_snapshots to authenticated;
grant all on public.crm_cleanup_snapshots to service_role;

create or replace function public.crm_cleanup_dry_run()
returns table(table_name text,before_count bigint,preserved_count bigint,removable_count bigint,created_count bigint,rule text)
language plpgsql stable security definer set search_path='' as $$
declare org uuid:=public.current_organization_id();
begin
  if not public.is_admin() then raise exception 'Apenas administradores podem gerar o dry-run de limpeza.';end if;
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
  if not public.is_admin() then raise exception 'Apenas administradores podem capturar o dry-run de limpeza.';end if;
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into payload from public.crm_cleanup_dry_run() r;
  insert into public.crm_cleanup_snapshots(organization_id,mode,report,created_by) values(org,'dry_run',payload,auth.uid()) returning id into snapshot_id;
  return snapshot_id;
end$$;
revoke all on function public.crm_cleanup_dry_run(),public.capture_crm_cleanup_dry_run() from public,anon;
grant execute on function public.crm_cleanup_dry_run(),public.capture_crm_cleanup_dry_run() to authenticated;

comment on function public.crm_cleanup_dry_run() is 'Relatório não destrutivo. Não existe rotina de DELETE nesta migration.';
comment on table public.access_role_presets is 'Preset futuro; não cria usuários nem concede acesso automaticamente.';

-- O futuro perfil operacional vê apenas conversas atribuídas a ele.
drop policy if exists whatsapp_conversations_read on public.whatsapp_conversations;
create policy whatsapp_conversations_read on public.whatsapp_conversations for select to authenticated using(
  organization_id=public.current_organization_id() and public.is_active_user() and (
    public.current_user_role() in('admin','manager','commercial','finance')
    or assigned_team_member_id=public.current_team_member_id()
  )
);
drop policy if exists whatsapp_messages_read on public.whatsapp_messages;
create policy whatsapp_messages_read on public.whatsapp_messages for select to authenticated using(
  organization_id=public.current_organization_id() and exists(
    select 1 from public.whatsapp_conversations c where c.id=whatsapp_messages.conversation_id and c.organization_id=whatsapp_messages.organization_id and (
      public.current_user_role() in('admin','manager','commercial','finance')
      or c.assigned_team_member_id=public.current_team_member_id()
    )
  )
);
drop policy if exists whatsapp_contacts_read on public.whatsapp_contacts;
create policy whatsapp_contacts_read on public.whatsapp_contacts for select to authenticated using(
  organization_id=public.current_organization_id() and (
    public.current_user_role() in('admin','manager','commercial','finance')
    or exists(select 1 from public.whatsapp_conversations c where c.contact_id=whatsapp_contacts.id and c.assigned_team_member_id=public.current_team_member_id())
  )
);
