create table if not exists public.whatsapp_message_templates(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  meta_template_id text,
  name text not null,
  language text not null,
  status text not null,
  category text,
  components jsonb not null default '[]'::jsonb,
  quality_score text,
  last_synced_at timestamptz not null default now(),
  sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,name,language)
);

alter table public.whatsapp_message_templates enable row level security;
create policy whatsapp_message_templates_read on public.whatsapp_message_templates
  for select to authenticated
  using(organization_id=public.current_organization_id() and public.is_active_user());
create policy whatsapp_message_templates_write on public.whatsapp_message_templates
  for all to authenticated
  using(organization_id=public.current_organization_id() and public.can_write())
  with check(organization_id=public.current_organization_id() and public.can_write());
create trigger set_updated_at before update on public.whatsapp_message_templates
  for each row execute function public.set_updated_at();

alter table public.whatsapp_collection_alerts
  add column if not exists recipient text,
  add column if not exists company_name text,
  add column if not exists template_language text,
  add column if not exists origin text not null default 'collection',
  add column if not exists sanitized_payload jsonb not null default '{}'::jsonb;
