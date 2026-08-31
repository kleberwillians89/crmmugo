-- Gatilhos de banco que originam eventos de automação a partir de mudanças reais do CRM.
-- Depende de 202608310001_whatsapp_automation_activation.sql (tabela automation_events).
-- PREPARAR APENAS: aplicar em local/staging sob revisão. Não aplicar remotamente sem gate.

-- Enfileira de forma segura (dedupe por chave; nunca duplica o mesmo assunto).
create or replace function public.emit_automation_event(
  p_organization_id uuid,
  p_event_type text,
  p_subject_id text,
  p_payload jsonb,
  p_dedupe_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.automation_events(
    organization_id, event_type, subject_id, sanitized_payload, dedupe_key, status
  )
  values (
    p_organization_id,
    left(p_event_type, 80),
    nullif(left(coalesce(p_subject_id, ''), 120), ''),
    coalesce(p_payload, '{}'::jsonb),
    nullif(left(coalesce(p_dedupe_key, ''), 200), ''),
    'pending'
  )
  on conflict (organization_id, dedupe_key) where dedupe_key is not null
  do nothing;
end
$$;

revoke all on function public.emit_automation_event(uuid, text, text, jsonb, text) from public, anon, authenticated;

-- 1. lead_created: cliente cadastrado como lead ou oportunidade ---------------------------
create or replace function public.automation_on_lead_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('lead', 'opportunity') then
    perform public.emit_automation_event(
      new.organization_id,
      'lead_created',
      new.id::text,
      jsonb_build_object(
        'subject_type', 'client',
        'client_id', new.id,
        'status', new.status,
        'segment', new.segment,
        'lead_source', new.lead_source
      ),
      'lead_created:' || new.id::text
    );
  end if;
  return new;
end
$$;

drop trigger if exists automation_lead_created on public.clients;
create trigger automation_lead_created
  after insert on public.clients
  for each row execute function public.automation_on_lead_created();

-- 2. invoice_overdue: parcela passou para o estado vencido ------------------------------
create or replace function public.automation_on_invoice_overdue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'overdue' and old.status is distinct from 'overdue' then
    perform public.emit_automation_event(
      new.organization_id,
      'invoice_overdue',
      new.id::text,
      jsonb_build_object(
        'subject_type', 'installment',
        'installment_id', new.id,
        'client_id', new.client_id,
        'contract_id', new.contract_id,
        'amount', new.amount,
        'due_date', new.due_date
      ),
      'invoice_overdue:' || new.id::text
    );
  end if;
  return new;
end
$$;

drop trigger if exists automation_invoice_overdue on public.invoice_installments;
create trigger automation_invoice_overdue
  after update on public.invoice_installments
  for each row execute function public.automation_on_invoice_overdue();

comment on function public.emit_automation_event(uuid, text, text, jsonb, text) is
  'Origina eventos de automação a partir de triggers de banco. security definer; nunca exposta a papéis do frontend.';
