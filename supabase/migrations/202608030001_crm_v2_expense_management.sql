-- CRM V2: contas a pagar. Migration aditiva; não insere nem altera dados reais.
create table if not exists public.expense_categories(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 name text not null check(length(trim(name)) between 1 and 120), description text, active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 created_by uuid references auth.users(id), updated_by uuid references auth.users(id),
 unique(organization_id,name), unique(organization_id,id)
);
create table if not exists public.cost_centers(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 name text not null check(length(trim(name)) between 1 and 120), description text, active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,name), unique(organization_id,id)
);
create table if not exists public.financial_accounts(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 name text not null check(length(trim(name)) between 1 and 120), account_type text not null check(account_type in('cash','checking','savings','credit_card','payment_account','other')),
 institution text, active boolean not null default true, opening_balance numeric(14,2) not null default 0,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,name), unique(organization_id,id)
);
create table if not exists public.expenses(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 name text not null check(length(trim(name)) between 1 and 180), description text, supplier_name text,
 category_id uuid, cost_center_id uuid, financial_account_id uuid,
 scope text not null default 'pending_review' check(scope in('business','personal','shared','pending_review')),
 responsible_name text, total_amount numeric(14,2) not null check(total_amount>=0),
 business_percentage numeric(5,2) not null default 0 check(business_percentage between 0 and 100),
 recurrence_type text not null default 'once' check(recurrence_type in('once','monthly','quarterly','semiannual','annual','installments')),
 due_day integer check(due_day between 1 and 31), start_date date, end_date date,
 installment_count integer check(installment_count>0), payment_method text,
 status text not null default 'draft' check(status in('draft','pending','partial','paid','cancelled')),
 validated boolean not null default false, notes text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 created_by uuid references auth.users(id), updated_by uuid references auth.users(id), deleted_at timestamptz,
 constraint expenses_scope_percentage_check check((scope='business' and business_percentage=100) or (scope in('personal','pending_review') and business_percentage=0) or (scope='shared' and business_percentage>0)),
 constraint expenses_validation_check check(scope<>'pending_review' or validated=false),
 constraint expenses_dates_check check(end_date is null or start_date is null or end_date>=start_date),
 constraint expenses_recurrence_check check(
   (recurrence_type='installments' and installment_count is not null and installment_count>0 and start_date is not null)
   or (recurrence_type in('monthly','quarterly','semiannual','annual') and start_date is not null)
   or recurrence_type='once'
 ),
 constraint expenses_category_tenant_fk foreign key(organization_id,category_id) references public.expense_categories(organization_id,id) on delete restrict,
 constraint expenses_cost_center_tenant_fk foreign key(organization_id,cost_center_id) references public.cost_centers(organization_id,id) on delete restrict,
 constraint expenses_financial_account_tenant_fk foreign key(organization_id,financial_account_id) references public.financial_accounts(organization_id,id) on delete restrict,
 unique(organization_id,id)
);
create table if not exists public.expense_installments(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 expense_id uuid not null, reference_month date not null,
 installment_number integer not null check(installment_number>0), due_date date not null,
 amount numeric(14,2) not null check(amount>=0), business_amount numeric(14,2) not null check(business_amount>=0 and business_amount<=amount),
 status text not null default 'pending' check(status in('draft','pending','partial','paid','overdue','cancelled')),
 paid_amount numeric(14,2) not null default 0 check(paid_amount>=0 and paid_amount<=amount), paid_at timestamptz,
 payment_method text, notes text, idempotency_key text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint expense_installments_expense_tenant_fk foreign key(organization_id,expense_id) references public.expenses(organization_id,id) on delete restrict,
 unique(organization_id,expense_id,reference_month,installment_number)
);

create index if not exists expense_categories_org_active_idx on public.expense_categories(organization_id,active);
create index if not exists cost_centers_org_active_idx on public.cost_centers(organization_id,active);
create index if not exists financial_accounts_org_active_idx on public.financial_accounts(organization_id,active);
create index if not exists expenses_org_status_due_idx on public.expenses(organization_id,status,start_date) where deleted_at is null;
create index if not exists expenses_org_scope_idx on public.expenses(organization_id,scope) where deleted_at is null;
create index if not exists expenses_org_deleted_idx on public.expenses(organization_id,deleted_at);
create index if not exists expense_installments_org_due_idx on public.expense_installments(organization_id,due_date,status);
create index if not exists expense_installments_expense_idx on public.expense_installments(expense_id);
create unique index if not exists expense_installments_idempotency_idx on public.expense_installments(organization_id,idempotency_key) where idempotency_key is not null;

do $$declare t text;begin foreach t in array array['expense_categories','cost_centers','financial_accounts','expenses','expense_installments'] loop
 execute format('drop trigger if exists set_updated_at on public.%I',t);
 execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()',t);
 execute format('alter table public.%I enable row level security',t);
 execute format('drop policy if exists %I_read on public.%I',t,t);
 execute format('drop policy if exists %I_write on public.%I',t,t);
 execute format('drop policy if exists %I_insert on public.%I',t,t);
 execute format('drop policy if exists %I_update on public.%I',t,t);
 execute format('create policy %I_read on public.%I for select to authenticated using(organization_id=public.current_organization_id() and public.is_active_user())',t,t);
 execute format('create policy %I_insert on public.%I for insert to authenticated with check(organization_id=public.current_organization_id() and public.can_write())',t,t);
 execute format('create policy %I_update on public.%I for update to authenticated using(organization_id=public.current_organization_id() and public.can_write()) with check(organization_id=public.current_organization_id() and public.can_write())',t,t);
 if to_regprocedure('public.capture_audit_log()') is not null then
  execute format('drop trigger if exists audit_changes on public.%I',t);
  execute format('create trigger audit_changes after insert or update or delete on public.%I for each row execute function public.capture_audit_log()',t);
 end if;
end loop;end$$;

-- Fonte de verdade do rateio empresarial. O trigger ignora business_amount enviado pelo cliente.
create or replace function public.expense_business_amount(expense_scope text, amount numeric, business_percentage numeric)
returns numeric language sql immutable strict set search_path='' as $$
 select case expense_scope
  when 'business' then round(amount,2)
  when 'shared' then round(amount*business_percentage/100,2)
  else 0::numeric
 end
$$;

create or replace function public.enforce_expense_installment_business_amount() returns trigger
language plpgsql security invoker set search_path='' as $$
declare e_scope text; e_percentage numeric;
begin
 select scope,business_percentage into e_scope,e_percentage
 from public.expenses
 where id=new.expense_id and organization_id=new.organization_id and deleted_at is null;
 if not found then raise exception 'A despesa não existe, está arquivada ou pertence a outra organização.'; end if;
 new.amount:=round(new.amount,2);
 new.paid_amount:=round(new.paid_amount,2);
 new.business_amount:=public.expense_business_amount(e_scope,new.amount,e_percentage);
 return new;
end$$;
drop trigger if exists enforce_business_amount on public.expense_installments;
create trigger enforce_business_amount before insert or update of organization_id,expense_id,amount,business_amount
on public.expense_installments for each row execute function public.enforce_expense_installment_business_amount();

create or replace function public.sync_expense_installment_business_amounts() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 update public.expense_installments
 set business_amount=public.expense_business_amount(new.scope,amount,new.business_percentage),updated_at=now()
 where expense_id=new.id and organization_id=new.organization_id;
 return new;
end$$;
drop trigger if exists sync_installment_business_amounts on public.expenses;
create trigger sync_installment_business_amounts after update of scope,business_percentage on public.expenses
for each row when (old.scope is distinct from new.scope or old.business_percentage is distinct from new.business_percentage)
execute function public.sync_expense_installment_business_amounts();

create or replace function public.generate_expense_installments(target_expense_id uuid) returns integer language plpgsql security definer set search_path='' as $$
declare e public.expenses%rowtype; cycles integer; step_months integer; i integer; competence date; due date; part numeric(14,2); business_part numeric(14,2); inserted_count integer:=0;
begin
 if auth.uid() is null or not public.can_write() then raise exception 'Você não tem permissão para gerar parcelas.'; end if;
 select * into e from public.expenses where id=target_expense_id and organization_id=public.current_organization_id() and deleted_at is null for update;
 if not found then raise exception 'Conta não encontrada.'; end if;
 step_months:=case e.recurrence_type when 'quarterly' then 3 when 'semiannual' then 6 when 'annual' then 12 else 1 end;
 cycles:=case
  when e.recurrence_type='installments' then e.installment_count
  when e.recurrence_type in('monthly','quarterly','semiannual','annual') and e.end_date is not null
   then greatest(1,floor(((date_part('year',age(e.end_date,e.start_date))*12+date_part('month',age(e.end_date,e.start_date)))::numeric)/step_months)::int+1)
  else 1 end;
 part:=round(e.total_amount/cycles,2);
 for i in 1..cycles loop
  competence:=date_trunc('month',coalesce(e.start_date,current_date)+(i-1)*step_months*interval '1 month')::date;
  due:=(competence+(least(coalesce(e.due_day,extract(day from coalesce(e.start_date,current_date))::int),extract(day from (competence+interval '1 month'-interval '1 day'))::int)-1)*interval '1 day')::date;
  if i=cycles then part:=e.total_amount-(part*(cycles-1)); end if;
  business_part:=case e.scope when 'business' then part when 'shared' then round(part*e.business_percentage/100,2) else 0 end;
  insert into public.expense_installments(organization_id,expense_id,reference_month,installment_number,due_date,amount,business_amount,idempotency_key)
  values(e.organization_id,e.id,competence,i,due,part,business_part,e.id::text||':'||competence::text||':'||i) on conflict(organization_id,expense_id,reference_month,installment_number) do nothing;
  if found then inserted_count:=inserted_count+1; end if;
 end loop;
 return inserted_count;
end$$;
revoke all on function public.generate_expense_installments(uuid) from public;
grant execute on function public.generate_expense_installments(uuid) to authenticated;
revoke all on function public.expense_business_amount(text,numeric,numeric) from public;
grant execute on function public.expense_business_amount(text,numeric,numeric) to authenticated;
