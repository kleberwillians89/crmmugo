-- Botão de triagem no repasse do atendimento (abre o WhatsApp da equipe Mugô). Idempotente.
alter table public.commercial_settings
  add column if not exists triage_cta_label text,
  add column if not exists triage_cta_url text,
  add column if not exists triage_cta_label_2 text,
  add column if not exists triage_cta_url_2 text;
alter table public.commercial_settings drop constraint if exists commercial_settings_triage_cta_label_check;
alter table public.commercial_settings add constraint commercial_settings_triage_cta_label_check check(triage_cta_label is null or char_length(triage_cta_label) <= 20);
alter table public.commercial_settings drop constraint if exists commercial_settings_triage_cta_url_check;
alter table public.commercial_settings add constraint commercial_settings_triage_cta_url_check check(triage_cta_url is null or triage_cta_url ~ '^https://');
