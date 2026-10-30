-- Contatos múltiplos por cliente, pagamento recorrente marcável e valor editável na cobrança.
-- Só estrutura (e cópia dos telefones que já existiam). A limpeza da carteira está na 202610300002.

begin;

-- ============================================================================
-- 1) Contatos do cliente (vários números; um principal)
-- ============================================================================
create table if not exists public.client_contacts(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  phone text,
  email text,
  role text,
  is_primary boolean not null default false,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users default auth.uid()
);

-- Telefone comparável: só dígitos; número nacional sem DDI (10/11 dígitos, sem "+") ganha 55.
create or replace function public.normalize_phone_digits(p_phone text) returns text
language sql immutable set search_path = '' as $$
  select case
    when d = '' then null
    when trim(coalesce(p_phone, '')) like '+%' then d
    when d like '00%' then substr(d, 3)
    when length(d) in (10, 11) and d not like '55%' then '55' || d
    else d end
  from (select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as d) x
$$;

create index if not exists client_contacts_client_idx on public.client_contacts(organization_id, client_id) where active;
create unique index if not exists client_contacts_one_primary on public.client_contacts(client_id) where active and is_primary;
create unique index if not exists client_contacts_unique_phone on public.client_contacts(client_id, public.normalize_phone_digits(phone)) where active and phone is not null;

alter table public.client_contacts enable row level security;
drop policy if exists client_contacts_read on public.client_contacts;
create policy client_contacts_read on public.client_contacts for select to authenticated
  using (organization_id = public.current_organization_id() and public.is_active_user());
drop policy if exists client_contacts_write on public.client_contacts;
create policy client_contacts_write on public.client_contacts for all to authenticated
  using (organization_id = public.current_organization_id() and public.can_write())
  with check (organization_id = public.current_organization_id() and public.can_write());
grant select, insert, update, delete on public.client_contacts to authenticated;
grant all on public.client_contacts to service_role;

drop trigger if exists set_updated_at on public.client_contacts;
create trigger set_updated_at before update on public.client_contacts for each row execute function public.set_updated_at();

-- Define o principal de forma atômica (o índice único não permite dois ao mesmo tempo).
create or replace function public.set_primary_client_contact(p_contact_id uuid) returns public.client_contacts
language plpgsql security definer set search_path = '' as $$
declare v_row public.client_contacts;
begin
  if not public.can_write() then raise exception 'Sem permissão para alterar contatos.'; end if;
  select * into v_row from public.client_contacts
  where id = p_contact_id and organization_id = public.current_organization_id() and active for update;
  if not found then raise exception 'Contato não encontrado.'; end if;
  update public.client_contacts set is_primary = false where client_id = v_row.client_id and is_primary and id <> v_row.id;
  update public.client_contacts set is_primary = true where id = v_row.id returning * into v_row;
  return v_row;
end $$;
revoke all on function public.set_primary_client_contact(uuid) from public;
grant execute on function public.set_primary_client_contact(uuid) to authenticated;

-- Backfill: todo cliente ganha os contatos que já existiam nos campos antigos.
insert into public.client_contacts(organization_id, client_id, name, phone, email, is_primary, created_by)
select c.organization_id, c.id,
  coalesce(nullif(trim(c.contact_name), ''), nullif(trim(c.trade_name), ''), c.company_name),
  nullif(trim(c.phone), ''), nullif(trim(c.email), ''), true, null
from public.clients c
where c.deleted_at is null
  and nullif(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), '') is not null
  and not exists (select 1 from public.client_contacts cc where cc.client_id = c.id);

insert into public.client_contacts(organization_id, client_id, name, phone, email, role, is_primary, created_by)
select c.organization_id, c.id,
  coalesce(nullif(trim(c.billing_contact_name), ''), 'Financeiro'),
  nullif(trim(c.billing_contact_phone), ''), nullif(trim(c.billing_contact_email), ''),
  coalesce(nullif(trim(c.billing_contact_role), ''), 'Financeiro'),
  not exists (select 1 from public.client_contacts cc where cc.client_id = c.id and cc.active and cc.is_primary),
  null
from public.clients c
where c.deleted_at is null
  and nullif(regexp_replace(coalesce(c.billing_contact_phone, ''), '\D', '', 'g'), '') is not null
  and not exists (
    select 1 from public.client_contacts cc
    where cc.client_id = c.id and cc.active
      and public.normalize_phone_digits(cc.phone) = public.normalize_phone_digits(c.billing_contact_phone)
  );

-- (Criado depois do backfill para não sobrescrever o contato financeiro antigo antes de copiá-lo.)
-- O contato principal continua espelhado em clients (contact_name/phone e contato financeiro),
-- porque relatórios, deduplicação e a IA de atendimento ainda leem esses campos.
create or replace function public.sync_client_primary_contact() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_client uuid := coalesce(new.client_id, old.client_id); v_primary record;
begin
  select name, phone, email into v_primary from public.client_contacts
  where client_id = v_client and active and is_primary limit 1;
  if found then
    update public.clients set
      contact_name = v_primary.name,
      phone = coalesce(v_primary.phone, phone),
      email = coalesce(email, v_primary.email),
      billing_contact_name = v_primary.name,
      billing_contact_phone = coalesce(v_primary.phone, billing_contact_phone)
    where id = v_client
      and (contact_name, phone, billing_contact_name, billing_contact_phone)
          is distinct from (v_primary.name, coalesce(v_primary.phone, phone), v_primary.name, coalesce(v_primary.phone, billing_contact_phone));
  end if;
  return null;
end $$;

drop trigger if exists sync_client_primary_contact on public.client_contacts;
create trigger sync_client_primary_contact after insert or update or delete on public.client_contacts
  for each row execute function public.sync_client_primary_contact();

-- ============================================================================
-- 2) Pagamento recorrente (marcado manualmente por contrato)
-- ============================================================================
alter table public.contracts add column if not exists is_recurring boolean not null default false;
comment on column public.contracts.is_recurring is 'Marcado manualmente: contrato com cobrança mensal recorrente. Gera a parcela do mês corrente e do próximo quando faltar.';

-- Gera, sem duplicar, a parcela mensal dos contratos recorrentes ativos (mês atual + próximo).
create or replace function public.ensure_recurring_installments(p_months integer default 2) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := public.current_organization_id(); v_count integer := 0; v_inserted integer;
  v_month date; v_start date := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date; i integer;
begin
  if v_org is null or not public.can_write() then return 0; end if;
  for i in 0 .. greatest(least(coalesce(p_months, 2), 6), 1) - 1 loop
    v_month := (v_start + make_interval(months => i))::date;
    insert into public.invoice_installments(organization_id, client_id, contract_id, reference_month, installment_number,
      due_date, amount, status, installment_type, currency, original_amount, description, source)
    select c.organization_id, c.client_id, c.id, v_month, 1,
      (v_month + (least(coalesce(c.billing_day, 5), extract(day from (v_month + interval '1 month' - interval '1 day'))::int) - 1))::date,
      c.monthly_value, 'pending', 'monthly', 'BRL', c.monthly_value, 'Mensalidade recorrente', 'contract'
    from public.contracts c
    where c.organization_id = v_org and c.is_recurring and c.status = 'active' and c.deleted_at is null
      and coalesce(c.monthly_value, 0) > 0
      and (c.start_date is null or date_trunc('month', c.start_date) <= v_month)
      and (c.end_date is null or c.end_date >= v_month)
      and not exists (select 1 from public.invoice_installments x
        where x.organization_id = c.organization_id and x.contract_id = c.id and x.reference_month = v_month and x.installment_type = 'monthly')
      and not exists (select 1 from public.financial_month_closings f
        where f.organization_id = c.organization_id and f.competence = v_month and f.status = 'closed')
    on conflict do nothing;
    get diagnostics v_inserted = row_count;
    v_count := v_count + v_inserted;
  end loop;
  return v_count;
end $$;
revoke all on function public.ensure_recurring_installments(integer) from public;
grant execute on function public.ensure_recurring_installments(integer) to authenticated;

-- ============================================================================
-- 3) Valor editado na hora da cobrança (somente parcela em aberto e sem recebimento)
-- ============================================================================
create or replace function public.update_open_installment_amount(p_installment_id uuid, p_amount numeric, p_reason text default null)
returns public.invoice_installments
language plpgsql security definer set search_path = '' as $$
declare v_row public.invoice_installments; v_old numeric;
begin
  if not public.can_write() then raise exception 'Sem permissão para alterar valores.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Informe um valor maior que zero.'; end if;
  select * into v_row from public.invoice_installments
  where id = p_installment_id and organization_id = public.current_organization_id() for update;
  if not found then raise exception 'Parcela não encontrada.'; end if;
  if v_row.status not in ('draft', 'pending', 'overdue') or coalesce(v_row.received_amount, 0) > 0 or v_row.paid_at is not null then
    raise exception 'Só dá para alterar o valor de parcela em aberto e sem recebimento.';
  end if;
  v_old := v_row.amount;
  if v_old = round(p_amount, 2) then return v_row; end if;
  update public.invoice_installments
    set amount = round(p_amount, 2), original_amount = round(p_amount, 2), currency = 'BRL', exchange_rate = 1
    where id = v_row.id returning * into v_row;
  insert into public.commercial_events(organization_id, client_id, contract_id, installment_id, event_type, title, description, old_value, new_value, created_by)
  values (v_row.organization_id, v_row.client_id, v_row.contract_id, v_row.id, 'installment_amount_changed', 'Valor da parcela alterado',
    nullif(trim(coalesce(p_reason, '')), ''), jsonb_build_object('amount', v_old), jsonb_build_object('amount', v_row.amount), auth.uid());
  return v_row;
end $$;
revoke all on function public.update_open_installment_amount(uuid, numeric, text) from public;
grant execute on function public.update_open_installment_amount(uuid, numeric, text) to authenticated;

commit;
