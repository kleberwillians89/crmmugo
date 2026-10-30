-- Cobrança automática por horário: no dia do vencimento às 9h, 12h e 18h; depois, nos dias seguintes,
-- até pagar (baixa manual ou do Asaas) ou o cliente tocar em "Já realizei o pagamento".
-- Substitui o disparo único do collection-notification-worker (que é desligado aqui para não duplicar).

begin;

alter table public.organization_settings
  add column if not exists collection_cadence_enabled boolean not null default false,
  add column if not exists collection_due_day_times text[] not null default '{09:00,12:00,18:00}',
  add column if not exists collection_overdue_times text[] not null default '{09:00}',
  add column if not exists collection_max_overdue_days integer not null default 15 check (collection_max_overdue_days between 0 and 90);
comment on column public.organization_settings.collection_due_day_times is 'Horários (HH:MM, fuso da empresa) de envio da cobrança no dia do vencimento.';
comment on column public.organization_settings.collection_overdue_times is 'Horários de envio nos dias seguintes ao vencimento, até o pagamento.';
comment on column public.organization_settings.collection_max_overdue_days is 'Para de enviar depois de tantos dias de atraso (a parcela continua em aberto).';

-- Um registro por parcela + horário: garante que cada envio acontece uma vez só.
create table if not exists public.collection_dispatch_log(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  installment_id uuid not null references public.invoice_installments(id),
  client_id uuid references public.clients(id),
  slot_key text not null,
  phone text,
  contact_name text,
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed', 'skipped')),
  provider_message_id text,
  payment_url text,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (installment_id, slot_key)
);
create index if not exists collection_dispatch_log_org_idx on public.collection_dispatch_log(organization_id, created_at desc);
alter table public.collection_dispatch_log enable row level security;
drop policy if exists collection_dispatch_log_read on public.collection_dispatch_log;
create policy collection_dispatch_log_read on public.collection_dispatch_log for select to authenticated
  using (organization_id = public.current_organization_id() and public.is_active_user());
grant select on public.collection_dispatch_log to authenticated;
grant all on public.collection_dispatch_log to service_role;

-- Liga a régua nova na Mugô e desliga o disparo único antigo (se a coluna existir).
update public.organization_settings s set collection_cadence_enabled = true
from public.organizations o where o.id = s.organization_id and o.slug = 'mugo';
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'organization_settings' and column_name = 'collection_dispatch_enabled') then
    execute 'update public.organization_settings s set collection_dispatch_enabled = false from public.organizations o where o.id = s.organization_id and o.slug = ''mugo''';
  end if;
end $$;

commit;
