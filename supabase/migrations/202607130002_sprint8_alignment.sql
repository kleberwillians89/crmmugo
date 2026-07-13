-- Correções incrementais da auditoria Sprint 8.
create table public.organization_settings(
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  company_name text not null, legal_name text, document_number text, billing_email text,
  pix_key text, pix_key_type text, bank_name text, whatsapp_number text,
  whatsapp_provider text, currency text not null default 'BRL',
  timezone text not null default 'America/Sao_Paulo', created_at timestamptz default now(), updated_at timestamptz default now()
);
insert into public.organization_settings(organization_id,company_name,legal_name,billing_email,pix_key,pix_key_type,bank_name,whatsapp_number,whatsapp_provider,currency,timezone)
select id,'Agência Mugô','Aurum Intelligence Ltda','mugo.agencia@gmail.com','mugo.agencia@gmail.com','email','Nubank','5511986531008','meta_cloud_api','BRL','America/Sao_Paulo' from public.organizations where slug='mugo'
on conflict(organization_id) do nothing;
alter table public.organization_settings enable row level security;
create policy organization_settings_read on public.organization_settings for select to authenticated using(organization_id=public.current_organization_id() and public.is_active_user());
create policy organization_settings_admin on public.organization_settings for update to authenticated using(organization_id=public.current_organization_id() and public.is_admin()) with check(organization_id=public.current_organization_id() and public.is_admin());
create trigger set_updated_at before update on public.organization_settings for each row execute function public.set_updated_at();
alter table public.invoice_installments add column if not exists operational_notes text;
alter table public.proposals add constraint proposals_org_legacy_unique unique(organization_id,legacy_id);
alter table public.contracts add constraint contracts_org_legacy_unique unique(organization_id,legacy_id);

-- View financeira segura para viewer, sem raw_payload.
create or replace view public.payments_safe with (security_invoker=true) as select id,organization_id,installment_id,provider,provider_payment_id,amount,status,payment_method,paid_at,created_at,updated_at from public.payments;
grant select on public.payments_safe to authenticated;npm run lint
npm run build
git status
drop policy if exists payments_view_safe on public.payments;
create policy payments_read on public.payments for select to authenticated using(organization_id=public.current_organization_id() and public.is_active_user());
revoke select(raw_payload) on public.payments from authenticated;
