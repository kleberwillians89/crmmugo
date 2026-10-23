-- Botões da equipe com clique registrado + reenvio único se o lead não abrir.
-- Aplicar pelo SQL Editor; depois: supabase migration repair --status applied 202610230002

create table if not exists public.whatsapp_cta_links(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  batch_id uuid not null,
  label text not null,
  target_url text not null check (target_url ~ '^https://'),
  click_count integer not null default 0,
  clicked_at timestamptz,
  resent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists whatsapp_cta_links_resend_idx on public.whatsapp_cta_links(created_at) where clicked_at is null and resent_at is null;
create index if not exists whatsapp_cta_links_conversation_idx on public.whatsapp_cta_links(organization_id, conversation_id, created_at desc);

alter table public.whatsapp_cta_links enable row level security;
drop policy if exists whatsapp_cta_links_select on public.whatsapp_cta_links;
create policy whatsapp_cta_links_select on public.whatsapp_cta_links for select to authenticated
  using (organization_id = public.current_organization_id());
grant select on public.whatsapp_cta_links to authenticated;

alter table public.commercial_settings add column if not exists cta_resend_after_minutes integer not null default 1200
  check (cta_resend_after_minutes between 60 and 1380);
