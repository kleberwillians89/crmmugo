-- Financeiro 2026: evolução aditiva sobre contratos, parcelas, despesas e pagamentos existentes.

alter table public.invoice_installments add column if not exists revenue_type text not null default 'fixed';
alter table public.invoice_installments add column if not exists currency text not null default 'BRL';
alter table public.invoice_installments add column if not exists original_amount numeric(14,2);
alter table public.invoice_installments add column if not exists exchange_rate numeric(14,6);
alter table public.invoice_installments add column if not exists projected_brl_amount numeric(14,2);
alter table public.invoice_installments add column if not exists actual_brl_amount numeric(14,2);
alter table public.invoice_installments add column if not exists destination text;
alter table public.invoice_installments add column if not exists financial_origin text not null default 'contract';
alter table public.invoice_installments drop constraint if exists invoice_installments_revenue_type_check;
alter table public.invoice_installments add constraint invoice_installments_revenue_type_check check(revenue_type in('fixed','freelance','extra')) not valid;
alter table public.invoice_installments drop constraint if exists invoice_installments_currency_check;
alter table public.invoice_installments add constraint invoice_installments_currency_check check(currency ~ '^[A-Z]{3}$') not valid;
alter table public.invoice_installments drop constraint if exists invoice_installments_exchange_rate_check;
alter table public.invoice_installments add constraint invoice_installments_exchange_rate_check check(exchange_rate is null or exchange_rate>0) not valid;
update public.invoice_installments set original_amount=coalesce(original_amount,amount),exchange_rate=coalesce(exchange_rate,1),projected_brl_amount=coalesce(projected_brl_amount,amount),actual_brl_amount=coalesce(actual_brl_amount,received_amount) where original_amount is null or projected_brl_amount is null;

create or replace function public.normalize_receivable_currency() returns trigger language plpgsql set search_path='' as $$
begin
  new.currency:=upper(coalesce(nullif(trim(new.currency),''),'BRL'));
  new.original_amount:=coalesce(new.original_amount,new.amount);
  if new.currency='BRL' then new.exchange_rate:=1;new.projected_brl_amount:=new.amount;new.actual_brl_amount:=new.received_amount;
  else
    if new.exchange_rate is null then raise exception 'Receita em moeda estrangeira exige taxa de câmbio.'; end if;
    new.projected_brl_amount:=round(new.original_amount*new.exchange_rate,2);
    new.amount:=new.projected_brl_amount;
    new.actual_brl_amount:=coalesce(new.actual_brl_amount,case when new.received_amount>0 then new.received_amount else null end);
  end if;
  new.reference_month:=date_trunc('month',new.reference_month)::date;
  return new;
end$$;
drop trigger if exists normalize_receivable_currency on public.invoice_installments;
create trigger normalize_receivable_currency before insert or update of currency,original_amount,exchange_rate,amount,received_amount,reference_month on public.invoice_installments for each row execute function public.normalize_receivable_currency();

alter table public.expenses add column if not exists area text;
alter table public.expenses add column if not exists launch_type text not null default 'actual';
alter table public.expenses add column if not exists essential boolean not null default false;
alter table public.expenses add column if not exists impacts_monthly_cap boolean not null default true;
alter table public.expenses add column if not exists financial_scope text;
alter table public.financial_accounts add column if not exists scope text not null default 'business';
alter table public.financial_accounts drop constraint if exists financial_accounts_scope_check;
alter table public.financial_accounts add constraint financial_accounts_scope_check check(scope in('business','household','private')) not valid;
update public.expenses set area=coalesce(area,case when scope='business' then 'business' when scope='shared' then 'shared' else 'household' end),financial_scope=coalesce(financial_scope,case when scope='business' then 'business' when scope='shared' then 'household' else 'private' end);
alter table public.expenses alter column area set default 'business';
alter table public.expenses alter column area set not null;
alter table public.expenses alter column financial_scope set default 'business';
alter table public.expenses alter column financial_scope set not null;
alter table public.expenses drop constraint if exists expenses_area_check;
alter table public.expenses add constraint expenses_area_check check(area in('business','household','shared')) not valid;
alter table public.expenses drop constraint if exists expenses_launch_type_check;
alter table public.expenses add constraint expenses_launch_type_check check(launch_type in('planned','actual')) not valid;
alter table public.expenses drop constraint if exists expenses_financial_scope_check;
alter table public.expenses add constraint expenses_financial_scope_check check(financial_scope in('business','household','private')) not valid;

create table if not exists public.financial_permissions(
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  permission text not null check(permission in('finance.view_business','finance.view_household','finance.view_private','finance.create_expense','finance.confirm_expense','finance.confirm_receipt','finance.view_debts','finance.manage_debts','finance.view_reserves','finance.manage_goals','finance.close_month','finance.export')),
  allowed boolean not null default true,granted_by uuid references public.profiles(id),created_at timestamptz not null default now(),
  primary key(profile_id,permission)
);
create or replace function public.has_financial_permission(p_permission text) returns boolean language sql stable security definer set search_path='' as $$
  select case
    when public.current_user_role() in('admin','owner') then true
    when exists(select 1 from public.financial_permissions p where p.organization_id=public.current_organization_id() and p.profile_id=auth.uid() and p.permission=p_permission) then coalesce((select allowed from public.financial_permissions p where p.organization_id=public.current_organization_id() and p.profile_id=auth.uid() and p.permission=p_permission),false)
    when public.current_user_role()='manager' then true
    when public.current_user_role()='finance' then p_permission in('finance.view_business','finance.create_expense','finance.confirm_expense','finance.confirm_receipt','finance.view_debts','finance.manage_debts','finance.view_reserves','finance.manage_goals','finance.export')
    else false end
$$;

alter table public.financial_command_confirmations add column if not exists action_type text not null default 'expense';
alter table public.financial_command_confirmations add column if not exists payload jsonb not null default '{}'::jsonb;
alter table public.financial_command_confirmations drop constraint if exists financial_command_action_type_check;
alter table public.financial_command_confirmations add constraint financial_command_action_type_check check(action_type in('expense','receipt','freelance_income')) not valid;
create or replace function public.can_view_financial_scope(p_scope text) returns boolean language sql stable security definer set search_path='' as $$
  select case p_scope when 'business' then public.has_financial_permission('finance.view_business') when 'household' then public.has_financial_permission('finance.view_household') when 'private' then public.has_financial_permission('finance.view_private') else false end
$$;

create table if not exists public.financial_monthly_budgets(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete restrict,
  competence date not null,category_id uuid references public.expense_categories(id) on delete restrict,scope text not null default 'business' check(scope in('business','household','private')),
  planned_amount numeric(14,2) not null check(planned_amount>=0),notes text,created_by uuid references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(organization_id,competence,category_id,scope),check(competence=date_trunc('month',competence)::date)
);
create table if not exists public.financial_monthly_plans(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete restrict,
  competence date not null,scope text not null default 'business' check(scope in('business','household','private')),
  monthly_cap numeric(14,2) not null default 0,debt_target numeric(14,2) not null default 0,reserve_target numeric(14,2) not null default 0,other_goals_target numeric(14,2) not null default 0,
  notes text,created_by uuid references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(organization_id,competence,scope),check(competence=date_trunc('month',competence)::date)
);
create table if not exists public.financial_debts(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null,creditor text,owner_scope text not null default 'business' check(owner_scope in('business','household','private')),
  initial_amount numeric(14,2) not null check(initial_amount>=0),current_balance numeric(14,2) not null check(current_balance>=0),current_installment integer,
  priority text not null default 'medium' check(priority in('low','medium','high','critical')),status text not null default 'open' check(status in('open','negotiating','installments','paid','pending_confirmation')),
  due_date date,include_in_plan boolean not null default true,plan_order integer,notes text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),created_by uuid references public.profiles(id),unique(organization_id,id)
);
create table if not exists public.debt_payments(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete restrict,debt_id uuid not null,
  amount numeric(14,2) not null check(amount>0),paid_on date not null,competence date not null,payment_method text,notes text,idempotency_key text not null,created_by uuid references public.profiles(id),created_at timestamptz not null default now(),
  constraint debt_payments_debt_tenant_fk foreign key(organization_id,debt_id) references public.financial_debts(organization_id,id) on delete restrict,
  unique(organization_id,idempotency_key),check(competence=date_trunc('month',competence)::date)
);
create table if not exists public.freelance_cash_movements(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete restrict,parent_movement_id uuid references public.freelance_cash_movements(id) on delete restrict,
  project_source text not null,type text not null check(type in('income','reserve','debt','business_reinvestment','extraordinary_withdrawal')),
  status text not null default 'forecast' check(status in('forecast','received','applied','cancelled','pending_confirmation')),amount numeric(14,2) not null check(amount>0),movement_date date not null,competence date not null,
  planned_destination text not null default 'undecided' check(planned_destination in('undecided','debt','safety_reserve','business_reinvestment','equipment','extraordinary_withdrawal','other')),
  applied boolean not null default false,scope text not null default 'business' check(scope in('business','household','private')),notes text,idempotency_key text,created_by uuid references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(organization_id,idempotency_key),check(competence=date_trunc('month',competence)::date)
);
create table if not exists public.financial_goals(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete restrict,name text not null,target_amount numeric(14,2) not null check(target_amount>0),
  deadline date,status text not null default 'active' check(status in('active','paused','achieved','cancelled')),rule jsonb not null default '{}'::jsonb,scope text not null default 'business' check(scope in('business','household','private')),
  created_by uuid references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(organization_id,id)
);
create table if not exists public.financial_goal_movements(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete restrict,goal_id uuid not null,amount numeric(14,2) not null,occurred_on date not null,competence date not null,
  source_type text not null default 'manual' check(source_type in('manual','freelance_cash','financial_account')),source_id uuid,notes text,idempotency_key text not null,created_by uuid references public.profiles(id),created_at timestamptz not null default now(),
  constraint financial_goal_movements_goal_tenant_fk foreign key(organization_id,goal_id) references public.financial_goals(organization_id,id) on delete restrict,
  unique(organization_id,idempotency_key),check(competence=date_trunc('month',competence)::date)
);
create table if not exists public.financial_month_closings(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete restrict,competence date not null,
  status text not null default 'closed' check(status in('closed','reopened')),snapshot jsonb not null,justification text,closed_by uuid not null references public.profiles(id),closed_at timestamptz not null default now(),reopened_by uuid references public.profiles(id),reopened_at timestamptz,
  unique(organization_id,competence),check(competence=date_trunc('month',competence)::date)
);

create or replace view public.financial_revenues with(security_invoker=true) as
select i.*,case when i.status='paid' then 'received' when i.status='overdue' or (i.due_date<current_date and i.status in('draft','pending','partial')) then 'overdue' else 'forecast' end revenue_status,
  coalesce(i.projected_brl_amount,i.amount) forecast_brl,coalesce(i.actual_brl_amount,i.received_amount) received_brl,c.end_date contract_end_date
from public.invoice_installments i join public.contracts c on c.id=i.contract_id and c.organization_id=i.organization_id;
grant select on public.financial_revenues to authenticated;

create or replace view public.financial_goals_progress with(security_invoker=true) as
select g.*,coalesce(sum(m.amount),0)::numeric(14,2) current_amount from public.financial_goals g left join public.financial_goal_movements m on m.goal_id=g.id and m.organization_id=g.organization_id group by g.id;
grant select on public.financial_goals_progress to authenticated;

create or replace function public.register_debt_payment(p_debt_id uuid,p_amount numeric,p_paid_on date,p_notes text,p_idempotency_key text) returns public.financial_debts language plpgsql security definer set search_path='' as $$
declare d public.financial_debts%rowtype;begin
  if not public.has_financial_permission('finance.manage_debts') then raise exception 'Sem permissão para pagar dívidas.';end if;
  select * into d from public.financial_debts where id=p_debt_id and organization_id=public.current_organization_id() for update;if not found then raise exception 'Dívida não encontrada.';end if;
  if p_amount<=0 or p_amount>d.current_balance then raise exception 'Pagamento inválido.';end if;
  insert into public.debt_payments(organization_id,debt_id,amount,paid_on,competence,notes,idempotency_key,created_by) values(d.organization_id,d.id,p_amount,p_paid_on,date_trunc('month',p_paid_on)::date,p_notes,p_idempotency_key,auth.uid()) on conflict(organization_id,idempotency_key) do nothing;
  if found then perform set_config('app.debt_payment','true',true);update public.financial_debts set current_balance=current_balance-p_amount,status=case when current_balance-p_amount=0 then 'paid' else status end,current_installment=coalesce(current_installment,0)+1 where id=d.id returning * into d;else select * into d from public.financial_debts where id=p_debt_id;end if;return d;
end$$;
create or replace function public.protect_debt_balance_history() returns trigger language plpgsql set search_path='' as $$begin
 if tg_op='INSERT' and new.current_balance<>new.initial_amount then raise exception 'O saldo inicial deve corresponder ao valor inicial.';end if;
 if tg_op='UPDATE' and new.current_balance is distinct from old.current_balance and current_setting('app.debt_payment',true) is distinct from 'true' then raise exception 'Registre um pagamento; não sobrescreva o saldo da dívida.';end if;
 if new.status='paid' and new.current_balance<>0 then raise exception 'Dívida paga deve possuir saldo zero.';end if;return new;
end$$;
drop trigger if exists protect_debt_balance_history on public.financial_debts;
create trigger protect_debt_balance_history before insert or update on public.financial_debts for each row execute function public.protect_debt_balance_history();
create or replace function public.register_goal_movement(p_goal_id uuid,p_amount numeric,p_occurred_on date,p_notes text,p_idempotency_key text) returns uuid language plpgsql security definer set search_path='' as $$
declare movement_id uuid;goal_scope text;begin
 if not public.has_financial_permission('finance.manage_goals') then raise exception 'Sem permissão para movimentar metas.';end if;
 select scope into goal_scope from public.financial_goals where id=p_goal_id and organization_id=public.current_organization_id();if not found or not public.can_view_financial_scope(goal_scope) then raise exception 'Meta não encontrada.';end if;
 insert into public.financial_goal_movements(organization_id,goal_id,amount,occurred_on,competence,notes,idempotency_key,created_by) values(public.current_organization_id(),p_goal_id,p_amount,p_occurred_on,date_trunc('month',p_occurred_on)::date,p_notes,p_idempotency_key,auth.uid()) on conflict(organization_id,idempotency_key) do update set notes=excluded.notes returning id into movement_id;return movement_id;
end$$;
create or replace function public.close_financial_month(p_competence date,p_justification text) returns public.financial_month_closings language plpgsql security definer set search_path='' as $$
declare c date:=date_trunc('month',p_competence)::date;s jsonb;r public.financial_month_closings%rowtype;v_cap numeric:=0;v_cap_spend numeric:=0;v_debt_target numeric:=0;v_debt_paid numeric:=0;v_paid_expense numeric:=0;v_goal numeric:=0;v_received numeric:=0;v_month_balance numeric:=0;v_accumulated numeric:=0;begin
  if not public.has_financial_permission('finance.close_month') then raise exception 'Sem permissão para fechar o mês.';end if;
  if nullif(trim(p_justification),'') is null then raise exception 'Informe uma justificativa para o fechamento.';end if;
  select jsonb_build_object(
   'fixed_revenue',coalesce(sum(coalesce(projected_brl_amount,amount)) filter(where revenue_type='fixed'),0),'freelance_revenue',coalesce(sum(coalesce(projected_brl_amount,amount)) filter(where revenue_type='freelance'),0),'extra_revenue',coalesce(sum(coalesce(projected_brl_amount,amount)) filter(where revenue_type='extra'),0),
   'received',coalesce(sum(received_amount),0),'all_fixed_received',coalesce(bool_and(status='paid') filter(where revenue_type='fixed'),true)
  ) into s from public.invoice_installments where organization_id=public.current_organization_id() and date_trunc('month',reference_month)::date=c and status<>'cancelled';
  s:=s||jsonb_build_object('business_expenses',(select coalesce(sum(ei.business_amount),0) from public.expense_installments ei join public.expenses e on e.id=ei.expense_id where ei.organization_id=public.current_organization_id() and ei.reference_month=c and ei.status<>'cancelled' and e.area='business'),'household_expenses',case when public.can_view_financial_scope('household') then(select coalesce(sum(ei.amount-ei.business_amount),0) from public.expense_installments ei join public.expenses e on e.id=ei.expense_id where ei.organization_id=public.current_organization_id() and ei.reference_month=c and ei.status<>'cancelled' and e.area in('household','shared')) else null end,'debt_paid',(select coalesce(sum(p.amount),0) from public.debt_payments p join public.financial_debts d on d.id=p.debt_id where p.organization_id=public.current_organization_id() and p.competence=c and public.can_view_financial_scope(d.owner_scope)),'goal_contributions',(select coalesce(sum(m.amount),0) from public.financial_goal_movements m join public.financial_goals g on g.id=m.goal_id where m.organization_id=public.current_organization_id() and m.competence=c and public.can_view_financial_scope(g.scope)));
  select coalesce(monthly_cap,0),coalesce(debt_target,0) into v_cap,v_debt_target from public.financial_monthly_plans where organization_id=public.current_organization_id() and competence=c and scope='business';
  select coalesce(sum(least(ei.paid_amount,ei.amount)),0),coalesce(sum(least(ei.paid_amount,ei.amount)) filter(where e.impacts_monthly_cap and e.financial_scope='business'),0) into v_paid_expense,v_cap_spend from public.expense_installments ei join public.expenses e on e.id=ei.expense_id where ei.organization_id=public.current_organization_id() and ei.reference_month=c and ei.status<>'cancelled';
  v_debt_paid:=coalesce((s->>'debt_paid')::numeric,0);v_goal:=coalesce((s->>'goal_contributions')::numeric,0);v_received:=coalesce((s->>'received')::numeric,0);v_month_balance:=v_received-v_paid_expense-v_debt_paid-v_goal;
  select coalesce(sum((snapshot->>'month_balance')::numeric),0) into v_accumulated from public.financial_month_closings where organization_id=public.current_organization_id() and competence<c and status='closed';
  s:=s||jsonb_build_object('paid_expenses',v_paid_expense,'monthly_cap',v_cap,'cap_spend',v_cap_spend,'cap_available',greatest(v_cap-v_cap_spend,0),'debt_target',v_debt_target,'month_balance',v_month_balance,'accumulated_balance',v_accumulated+v_month_balance,'within_cap',v_cap=0 or v_cap_spend<=v_cap,'debt_target_met',v_debt_paid>=v_debt_target);
  insert into public.financial_month_closings(organization_id,competence,snapshot,justification,closed_by) values(public.current_organization_id(),c,s,p_justification,auth.uid()) on conflict(organization_id,competence) do update set status='closed',snapshot=excluded.snapshot,justification=excluded.justification,closed_by=excluded.closed_by,closed_at=now(),reopened_by=null,reopened_at=null returning * into r;return r;
end$$;
create or replace function public.reopen_financial_month(p_competence date,p_justification text) returns void language plpgsql security definer set search_path='' as $$begin
  if public.current_user_role() not in('admin','owner') or nullif(trim(p_justification),'') is null then raise exception 'Reabertura exige administrador e justificativa.';end if;
  update public.financial_month_closings set status='reopened',justification=justification||E'\nReabertura: '||p_justification,reopened_by=auth.uid(),reopened_at=now() where organization_id=public.current_organization_id() and competence=date_trunc('month',p_competence)::date and status='closed';
end$$;
create or replace function public.protect_closed_financial_period() returns trigger language plpgsql set search_path='' as $$declare org uuid:=coalesce(new.organization_id,old.organization_id);v_competence date;begin
  v_competence:=case tg_table_name when 'invoice_installments' then date_trunc('month',coalesce(new.reference_month,old.reference_month))::date when 'expense_installments' then date_trunc('month',coalesce(new.reference_month,old.reference_month))::date when 'debt_payments' then coalesce(new.competence,old.competence) when 'freelance_cash_movements' then coalesce(new.competence,old.competence) when 'financial_goal_movements' then coalesce(new.competence,old.competence) end;
  if exists(select 1 from public.financial_month_closings where organization_id=org and competence=v_competence and status='closed') then raise exception 'Competência fechada. Reabra com permissão elevada e justificativa.';end if;return coalesce(new,old);
end$$;
create or replace function public.protect_expense_closed_period() returns trigger language plpgsql set search_path='' as $$begin
 if (new.area,new.financial_scope,new.category_id,new.cost_center_id,new.launch_type,new.impacts_monthly_cap,new.total_amount) is distinct from (old.area,old.financial_scope,old.category_id,old.cost_center_id,old.launch_type,old.impacts_monthly_cap,old.total_amount) and exists(select 1 from public.expense_installments ei join public.financial_month_closings c on c.organization_id=ei.organization_id and c.competence=ei.reference_month and c.status='closed' where ei.expense_id=new.id) then raise exception 'A despesa possui competência fechada. Reabra o mês com justificativa.';end if;return new;
end$$;
drop trigger if exists protect_expense_closed_period on public.expenses;
create trigger protect_expense_closed_period before update on public.expenses for each row execute function public.protect_expense_closed_period();

create or replace function public.audit_installment_receivable() returns trigger language plpgsql security definer set search_path='' as $$
declare role_name text:=public.current_user_role();event_name text;begin
 if new.status is not distinct from old.status or(new.status<>'paid' and old.status<>'paid') then return new;end if;
 if current_setting('app.receipt_rpc',true)='true' then return new;end if;
 if not public.has_financial_permission('finance.confirm_receipt') and auth.role()<>'service_role' then raise exception 'Apenas usuários financeiros autorizados podem confirmar recebimentos.';end if;
 if old.status='paid' and new.status<>'paid' and role_name<>'admin' and auth.role()<>'service_role' then raise exception 'Apenas administradores podem estornar recebimentos.';end if;
 event_name:=case when new.status='paid' then 'installment_payment_registered' else 'installment_payment_reversed' end;
 if new.status='paid' then new.manual_confirmation_by:=auth.uid();new.manual_confirmation_at:=coalesce(new.manual_confirmation_at,now());new.paid_at:=coalesce(new.paid_at,now());end if;
 insert into public.commercial_events(organization_id,client_id,contract_id,installment_id,event_type,title,description,old_value,new_value,created_by) values(new.organization_id,new.client_id,new.contract_id,new.id,event_name,case when new.status='paid' then 'Recebimento de mensalidade registrado' else 'Recebimento de mensalidade estornado' end,new.operational_notes,jsonb_build_object('status',old.status,'amount',old.amount,'received',old.received_amount),jsonb_build_object('status',new.status,'amount',new.amount,'received',new.received_amount),auth.uid());return new;
end$$;
create or replace function public.confirm_installment_receipt(target_id uuid,new_received_amount numeric,received_on date,payment_method_name text,payment_note text default null) returns public.invoice_installments language plpgsql security definer set search_path='' as $$
declare old_row public.invoice_installments%rowtype;new_row public.invoice_installments%rowtype;role_name text:=public.current_user_role();new_status text;event_name text;begin
 if not public.has_financial_permission('finance.confirm_receipt') then raise exception 'Você não tem permissão para confirmar recebimentos.';end if;
 select * into old_row from public.invoice_installments where id=target_id and organization_id=public.current_organization_id() for update;if old_row.id is null then raise exception 'Parcela não encontrada.';end if;
 if new_received_amount<0 then raise exception 'O valor recebido não pode ser negativo.';end if;if new_received_amount<old_row.received_amount and role_name not in('admin','owner') then raise exception 'Apenas administradores podem corrigir ou estornar recebimentos.';end if;
 new_status:=case when new_received_amount=0 then case when old_row.due_date<current_date then 'overdue' else 'pending' end when new_received_amount<old_row.amount then 'partial' else 'paid' end;
 event_name:=case when new_received_amount=0 and old_row.received_amount>0 then 'installment_payment_reversed' when new_received_amount<old_row.received_amount then 'installment_payment_corrected' when new_received_amount<old_row.amount then 'installment_partial_payment_registered' when old_row.received_amount>0 then 'installment_payment_corrected' else 'installment_payment_registered' end;
 perform set_config('app.receipt_rpc','true',true);update public.invoice_installments set received_amount=new_received_amount,actual_brl_amount=new_received_amount,status=new_status,paid_at=case when new_status='paid' then received_on::timestamptz else null end,payment_method=case when new_received_amount>0 then payment_method_name else null end,payment_notes=payment_note,operational_notes=payment_note,manual_confirmation_by=auth.uid(),manual_confirmation_at=now() where id=old_row.id returning * into new_row;
 insert into public.commercial_events(organization_id,client_id,contract_id,installment_id,event_type,title,description,old_value,new_value,created_by) values(old_row.organization_id,old_row.client_id,old_row.contract_id,old_row.id,event_name,case when new_status='partial' then 'Recebimento parcial registrado' when new_status='paid' then 'Recebimento de mensalidade registrado' when new_received_amount=0 then 'Recebimento estornado' else 'Recebimento corrigido' end,payment_note,to_jsonb(old_row),to_jsonb(new_row),auth.uid());return new_row;
end$$;
create or replace function public.confirm_installment_receipt_internal(p_installment_id uuid,p_amount numeric,p_command_event_id uuid) returns public.invoice_installments language plpgsql security definer set search_path='' as $$
declare r public.invoice_installments%rowtype;begin
 if auth.role()<>'service_role' then raise exception 'Função exclusiva do worker interno.';end if;
 select * into r from public.invoice_installments where id=p_installment_id for update;if not found then raise exception 'Parcela não encontrada.';end if;
 if not exists(select 1 from public.task_command_events where id=p_command_event_id and organization_id=r.organization_id) then raise exception 'Comando financeiro inválido.';end if;
 update public.invoice_installments set received_amount=least(amount,p_amount),actual_brl_amount=least(amount,p_amount),status=case when p_amount>=amount then 'paid' else 'partial' end,payment_method='other',operational_notes='Confirmado por comando interno '||p_command_event_id::text where id=r.id returning * into r;return r;
end$$;

create or replace function public.generate_expense_installments(target_expense_id uuid) returns integer language plpgsql security definer set search_path='' as $$
declare e public.expenses%rowtype;cycles integer;step_months integer;i integer;competence date;due date;part numeric(14,2);business_part numeric(14,2);inserted_count integer:=0;begin
 if auth.uid() is null or not public.has_financial_permission('finance.create_expense') then raise exception 'Você não tem permissão para gerar parcelas.';end if;
 select * into e from public.expenses where id=target_expense_id and organization_id=public.current_organization_id() and deleted_at is null for update;if not found then raise exception 'Conta não encontrada.';end if;
 step_months:=case e.recurrence_type when 'quarterly' then 3 when 'semiannual' then 6 when 'annual' then 12 else 1 end;
 cycles:=case when e.recurrence_type='installments' then e.installment_count when e.recurrence_type in('monthly','quarterly','semiannual','annual') and e.end_date is not null then greatest(1,floor(((date_part('year',age(e.end_date,e.start_date))*12+date_part('month',age(e.end_date,e.start_date)))::numeric)/step_months)::int+1) else 1 end;
 part:=round(e.total_amount/cycles,2);
 for i in 1..cycles loop competence:=date_trunc('month',coalesce(e.start_date,current_date)+(i-1)*step_months*interval '1 month')::date;due:=(competence+(least(coalesce(e.due_day,extract(day from coalesce(e.start_date,current_date))::int),extract(day from(competence+interval '1 month'-interval '1 day'))::int)-1)*interval '1 day')::date;if i=cycles then part:=e.total_amount-(part*(cycles-1));end if;business_part:=public.expense_business_amount(e.scope,part,e.business_percentage);insert into public.expense_installments(organization_id,expense_id,reference_month,installment_number,due_date,amount,business_amount,idempotency_key) values(e.organization_id,e.id,competence,i,due,part,business_part,e.id::text||':'||competence::text||':'||i) on conflict(organization_id,expense_id,reference_month,installment_number) do nothing;if found then inserted_count:=inserted_count+1;end if;end loop;return inserted_count;
end$$;

do $$ declare t text;begin
 foreach t in array array['financial_permissions','financial_monthly_budgets','financial_monthly_plans','financial_debts','debt_payments','freelance_cash_movements','financial_goals','financial_goal_movements','financial_month_closings'] loop
  execute format('alter table public.%I enable row level security',t);execute format('alter table public.%I force row level security',t);
  execute format('grant select,insert,update on public.%I to authenticated',t);execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end$$;
create policy financial_permissions_admin on public.financial_permissions for all to authenticated using(organization_id=public.current_organization_id() and public.is_admin()) with check(organization_id=public.current_organization_id() and public.is_admin());
create policy financial_budgets_scope on public.financial_monthly_budgets for all to authenticated using(organization_id=public.current_organization_id() and public.can_view_financial_scope(scope)) with check(organization_id=public.current_organization_id() and public.can_view_financial_scope(scope));
create policy financial_plans_scope on public.financial_monthly_plans for all to authenticated using(organization_id=public.current_organization_id() and public.can_view_financial_scope(scope)) with check(organization_id=public.current_organization_id() and public.can_view_financial_scope(scope));
create policy financial_debts_scope on public.financial_debts for select to authenticated using(organization_id=public.current_organization_id() and public.has_financial_permission('finance.view_debts') and public.can_view_financial_scope(owner_scope));
create policy financial_debts_manage on public.financial_debts for all to authenticated using(organization_id=public.current_organization_id() and public.has_financial_permission('finance.manage_debts') and public.can_view_financial_scope(owner_scope)) with check(organization_id=public.current_organization_id() and public.has_financial_permission('finance.manage_debts') and public.can_view_financial_scope(owner_scope));
create policy debt_payments_read on public.debt_payments for select to authenticated using(organization_id=public.current_organization_id() and exists(select 1 from public.financial_debts d where d.id=debt_id and public.can_view_financial_scope(d.owner_scope)));
create policy freelance_cash_scope on public.freelance_cash_movements for all to authenticated using(organization_id=public.current_organization_id() and public.can_view_financial_scope(scope)) with check(organization_id=public.current_organization_id() and public.can_view_financial_scope(scope));
create policy financial_goals_scope on public.financial_goals for all to authenticated using(organization_id=public.current_organization_id() and public.has_financial_permission('finance.view_reserves') and public.can_view_financial_scope(scope)) with check(organization_id=public.current_organization_id() and public.has_financial_permission('finance.manage_goals') and public.can_view_financial_scope(scope));
create policy financial_goal_movements_read on public.financial_goal_movements for select to authenticated using(organization_id=public.current_organization_id() and exists(select 1 from public.financial_goals g where g.id=goal_id and public.can_view_financial_scope(g.scope)));
create policy financial_closings_read on public.financial_month_closings for select to authenticated using(organization_id=public.current_organization_id() and public.has_financial_permission('finance.close_month'));

drop policy if exists expenses_read on public.expenses;create policy expenses_read on public.expenses for select to authenticated using(organization_id=public.current_organization_id() and public.can_view_financial_scope(financial_scope));
drop policy if exists expense_installments_read on public.expense_installments;create policy expense_installments_read on public.expense_installments for select to authenticated using(organization_id=public.current_organization_id() and exists(select 1 from public.expenses e where e.id=expense_id and public.can_view_financial_scope(e.financial_scope)));
drop policy if exists financial_accounts_read on public.financial_accounts;drop policy if exists financial_accounts_insert on public.financial_accounts;drop policy if exists financial_accounts_update on public.financial_accounts;
create policy financial_accounts_read on public.financial_accounts for select to authenticated using(organization_id=public.current_organization_id() and public.can_view_financial_scope(scope));
create policy financial_accounts_insert on public.financial_accounts for insert to authenticated with check(organization_id=public.current_organization_id() and public.can_view_financial_scope(scope) and public.has_financial_permission('finance.create_expense'));
create policy financial_accounts_update on public.financial_accounts for update to authenticated using(organization_id=public.current_organization_id() and public.can_view_financial_scope(scope) and public.has_financial_permission('finance.create_expense')) with check(organization_id=public.current_organization_id() and public.can_view_financial_scope(scope));
drop policy if exists expenses_insert on public.expenses;drop policy if exists expenses_update on public.expenses;
create policy expenses_insert on public.expenses for insert to authenticated with check(organization_id=public.current_organization_id() and public.has_financial_permission('finance.create_expense') and public.can_view_financial_scope(financial_scope));
create policy expenses_update on public.expenses for update to authenticated using(organization_id=public.current_organization_id() and public.has_financial_permission('finance.confirm_expense') and public.can_view_financial_scope(financial_scope)) with check(organization_id=public.current_organization_id() and public.has_financial_permission('finance.confirm_expense') and public.can_view_financial_scope(financial_scope));
drop policy if exists expense_installments_insert on public.expense_installments;drop policy if exists expense_installments_update on public.expense_installments;
create policy expense_installments_insert on public.expense_installments for insert to authenticated with check(organization_id=public.current_organization_id() and exists(select 1 from public.expenses e where e.id=expense_id and e.organization_id=expense_installments.organization_id and public.has_financial_permission('finance.create_expense') and public.can_view_financial_scope(e.financial_scope)));
create policy expense_installments_update on public.expense_installments for update to authenticated using(organization_id=public.current_organization_id() and exists(select 1 from public.expenses e where e.id=expense_id and e.organization_id=expense_installments.organization_id and public.has_financial_permission('finance.confirm_expense') and public.can_view_financial_scope(e.financial_scope))) with check(organization_id=public.current_organization_id() and exists(select 1 from public.expenses e where e.id=expense_id and e.organization_id=expense_installments.organization_id and public.has_financial_permission('finance.confirm_expense') and public.can_view_financial_scope(e.financial_scope)));

create or replace function public.protect_financial_hub_tenant() returns trigger language plpgsql set search_path='' as $$begin
 if tg_table_name='financial_permissions' and not exists(select 1 from public.profiles where id=new.profile_id and organization_id=new.organization_id) then raise exception 'Financial permission tenant mismatch' using errcode='23514';
 elsif tg_table_name='financial_monthly_budgets' and new.category_id is not null and not exists(select 1 from public.expense_categories where id=new.category_id and organization_id=new.organization_id) then raise exception 'Financial budget tenant mismatch' using errcode='23514';
 elsif tg_table_name='freelance_cash_movements' and new.parent_movement_id is not null and not exists(select 1 from public.freelance_cash_movements where id=new.parent_movement_id and organization_id=new.organization_id) then raise exception 'Freelance cash tenant mismatch' using errcode='23514';end if;return new;
end$$;
do $$declare t text;begin foreach t in array array['financial_permissions','financial_monthly_budgets','freelance_cash_movements'] loop execute format('drop trigger if exists protect_financial_hub_tenant on public.%I',t);execute format('create trigger protect_financial_hub_tenant before insert or update on public.%I for each row execute function public.protect_financial_hub_tenant()',t);end loop;end$$;

do $$ declare t text;begin foreach t in array array['invoice_installments','expense_installments','debt_payments','freelance_cash_movements','financial_goal_movements'] loop execute format('drop trigger if exists protect_closed_financial_period on public.%I',t);execute format('create trigger protect_closed_financial_period before insert or update or delete on public.%I for each row execute function public.protect_closed_financial_period()',t);end loop;end$$;
do $$ declare t text;begin foreach t in array array['financial_monthly_budgets','financial_monthly_plans','financial_debts','freelance_cash_movements','financial_goals'] loop execute format('drop trigger if exists set_updated_at on public.%I',t);execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()',t);end loop;end$$;
revoke all on function public.register_debt_payment(uuid,numeric,date,text,text),public.register_goal_movement(uuid,numeric,date,text,text),public.close_financial_month(date,text),public.reopen_financial_month(date,text) from public;
grant execute on function public.register_debt_payment(uuid,numeric,date,text,text),public.register_goal_movement(uuid,numeric,date,text,text),public.close_financial_month(date,text),public.reopen_financial_month(date,text) to authenticated;
grant execute on function public.confirm_installment_receipt(uuid,numeric,date,text,text) to authenticated;
revoke all on function public.confirm_installment_receipt_internal(uuid,numeric,uuid) from public,anon,authenticated;
grant execute on function public.confirm_installment_receipt_internal(uuid,numeric,uuid) to service_role;

comment on view public.financial_revenues is 'Projeção financeira das parcelas canônicas; não inclui pipeline comercial.';
comment on table public.freelance_cash_movements is 'Caixa extraordinário isolado do caixa operacional recorrente.';
