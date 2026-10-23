-- Inscrição pública na newsletter (página /news) com confirmação por e-mail (double opt-in),
-- origem da campanha (UTM) e pedido de contato opcional que vira lead no funil.
-- Aplicar pelo SQL Editor; depois: npx supabase migration repair --status applied 202610230003

create table if not exists public.newsletter_signups(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (email = lower(trim(email))),
  name text,
  status text not null default 'pending' check (status in ('pending','confirmed')),
  confirm_token uuid not null default gen_random_uuid() unique,
  consent_text text not null,
  consent_at timestamptz not null default now(),
  wants_contact boolean not null default false,
  phone text,
  company text,
  interest text,
  attribution jsonb not null default '{}'::jsonb,
  ip_hash text,
  user_agent text,
  confirmations_sent integer not null default 0,
  confirmation_sent_at timestamptz,
  confirmed_at timestamptz,
  contact_id uuid references public.email_contacts(id) on delete set null,
  opportunity_id uuid references public.commercial_opportunities(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists newsletter_signups_email_idx on public.newsletter_signups(organization_id, email, created_at desc);
create index if not exists newsletter_signups_ip_idx on public.newsletter_signups(ip_hash, created_at desc);
create index if not exists newsletter_signups_created_idx on public.newsletter_signups(organization_id, created_at desc);

alter table public.newsletter_signups enable row level security;
drop policy if exists newsletter_signups_select on public.newsletter_signups;
create policy newsletter_signups_select on public.newsletter_signups for select to authenticated
  using (organization_id = public.current_organization_id());
grant select on public.newsletter_signups to authenticated;

-- Prova do aceite e origem guardadas no contato (LGPD).
alter table public.email_contacts add column if not exists consent_at timestamptz;
alter table public.email_contacts add column if not exists consent_text text;
alter table public.email_contacts add column if not exists attribution jsonb not null default '{}'::jsonb;

-- Pixel da Meta (opcional) usado pela página de inscrição.
alter table public.newsletter_settings add column if not exists meta_pixel_id text
  check (meta_pixel_id is null or meta_pixel_id ~ '^[0-9]{6,20}$');
alter table public.newsletter_settings add column if not exists signup_enabled boolean not null default true;

comment on table public.newsletter_signups is 'Inscrições da página pública /news. Só viram contato (email_contacts, tag newsletter) depois do clique de confirmação.';
