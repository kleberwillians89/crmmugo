alter table public.whatsapp_message_templates
  add column if not exists waba_id text,
  add column if not exists rejected_reason text,
  add column if not exists previous_category text,
  add column if not exists parameter_format text,
  add column if not exists raw_payload jsonb not null default '{}'::jsonb,
  add column if not exists meta_created_at timestamptz,
  add column if not exists meta_updated_at timestamptz,
  add column if not exists is_active boolean not null default true;

update public.whatsapp_message_templates
set waba_id='legacy'
where waba_id is null;

alter table public.whatsapp_message_templates
  alter column waba_id set not null;

alter table public.whatsapp_message_templates
  drop constraint if exists whatsapp_message_templates_organization_id_name_language_key;

create unique index if not exists whatsapp_message_templates_waba_name_language_uidx
  on public.whatsapp_message_templates(organization_id,waba_id,name,language);

create index if not exists whatsapp_message_templates_status_idx
  on public.whatsapp_message_templates(organization_id,waba_id,is_active,status,last_synced_at desc);

alter table public.whatsapp_collection_alerts
  add column if not exists meta_template_id text,
  add column if not exists currency text not null default 'BRL',
  add column if not exists raw_response jsonb not null default '{}'::jsonb,
  add column if not exists failed_at timestamptz,
  add column if not exists cost numeric(14,6),
  add column if not exists cost_source text,
  add column if not exists pricing_category text;

create unique index if not exists whatsapp_collection_alerts_provider_message_uidx
  on public.whatsapp_collection_alerts(organization_id,provider_message_id)
  where provider_message_id is not null;
