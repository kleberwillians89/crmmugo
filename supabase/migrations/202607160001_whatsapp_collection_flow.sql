create table if not exists public.whatsapp_conversation_links(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  client_id uuid not null references public.clients(id) on delete cascade,
  wa_id text not null,
  phone text not null,
  conversation_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,client_id),
  unique(organization_id,wa_id)
);
create table if not exists public.whatsapp_collection_alerts(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  client_id uuid not null references public.clients(id) on delete cascade,
  installment_id uuid not null references public.invoice_installments(id) on delete restrict,
  contract_id uuid references public.contracts(id) on delete set null,
  wa_id text not null,
  template_name text not null,
  provider_message_id text,
  template_status text,
  collection_stage text not null default 'alert',
  action text not null default 'template_sent',
  status text not null default 'sent' check(status in('sending','sent','failed','responded','waiting_finance','negotiating','paid')),
  sent_by uuid references auth.users(id),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  customer_replied_at timestamptz,
  attended_at timestamptz,
  paid_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,installment_id,template_name)
);
alter table public.whatsapp_conversation_links enable row level security;
alter table public.whatsapp_collection_alerts enable row level security;
create policy whatsapp_conversation_links_read on public.whatsapp_conversation_links for select to authenticated using(organization_id=public.current_organization_id() and public.is_active_user());
create policy whatsapp_conversation_links_write on public.whatsapp_conversation_links for all to authenticated using(organization_id=public.current_organization_id() and public.can_write()) with check(organization_id=public.current_organization_id() and public.can_write());
create policy whatsapp_collection_alerts_read on public.whatsapp_collection_alerts for select to authenticated using(organization_id=public.current_organization_id() and public.is_active_user());
create policy whatsapp_collection_alerts_write on public.whatsapp_collection_alerts for all to authenticated using(organization_id=public.current_organization_id() and public.can_write()) with check(organization_id=public.current_organization_id() and public.can_write());
create index if not exists whatsapp_links_phone_idx on public.whatsapp_conversation_links(organization_id,phone);
create index if not exists whatsapp_alerts_status_idx on public.whatsapp_collection_alerts(organization_id,status,created_at desc);
create trigger set_updated_at before update on public.whatsapp_conversation_links for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.whatsapp_collection_alerts for each row execute function public.set_updated_at();
