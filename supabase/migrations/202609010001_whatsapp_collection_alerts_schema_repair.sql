-- Repair de drift em whatsapp_collection_alerts.
-- As migrations históricas constam como aplicadas, mas parte do schema
-- não existe no banco de produção.

alter table public.whatsapp_collection_alerts
  add column if not exists contract_id uuid
    references public.contracts(id) on delete set null,
  add column if not exists template_status text,
  add column if not exists collection_stage text not null default 'alert',
  add column if not exists action text not null default 'template_sent',
  add column if not exists delivered_at timestamptz,
  add column if not exists read_at timestamptz,
  add column if not exists customer_replied_at timestamptz,
  add column if not exists attended_at timestamptz,
  add column if not exists paid_at timestamptz,
  add column if not exists error_code text,
  add column if not exists error_message text;

-- A constraint existente é uma versão antiga e impede estados
-- que já fazem parte do fluxo financeiro atual.
alter table public.whatsapp_collection_alerts
  drop constraint if exists whatsapp_collection_alerts_status_check;

alter table public.whatsapp_collection_alerts
  add constraint whatsapp_collection_alerts_status_check
  check (
    status in (
      'sending',
      'sent',
      'failed',
      'responded',
      'waiting_finance',
      'negotiating',
      'paid'
    )
  );
