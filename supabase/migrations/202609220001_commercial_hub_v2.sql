-- Commercial Hub V2: qualificação comercial aditiva. Não ativa a IA.

alter table public.commercial_opportunities
  add column if not exists temperature text not null default 'cold',
  add column if not exists temperature_reason text,
  add column if not exists lead_kind text not null default 'other',
  add column if not exists lead_kind_reason text;

alter table public.commercial_opportunities
  drop constraint if exists commercial_opportunities_temperature_check;
alter table public.commercial_opportunities
  add constraint commercial_opportunities_temperature_check
  check (temperature in ('cold','warm','hot')) not valid;

alter table public.commercial_opportunities
  drop constraint if exists commercial_opportunities_lead_kind_check;
alter table public.commercial_opportunities
  add constraint commercial_opportunities_lead_kind_check
  check (lead_kind in ('new_business','existing_client','support','finance','partnership','other')) not valid;

create index if not exists commercial_opportunities_temperature_idx
  on public.commercial_opportunities(organization_id,temperature,stage,updated_at desc);

create or replace function public.cancel_closed_opportunity_followups()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.stage in ('won','lost') and old.stage is distinct from new.stage then
    update public.crm_tasks
       set status = 'cancelled', completed_at = null, updated_at = now()
     where organization_id = new.organization_id
       and opportunity_id = new.id
       and task_type = 'follow_up'
       and status in ('pending','in_progress');
  end if;
  return new;
end;
$$;

drop trigger if exists cancel_closed_opportunity_followups on public.commercial_opportunities;
create trigger cancel_closed_opportunity_followups
after update of stage on public.commercial_opportunities
for each row execute function public.cancel_closed_opportunity_followups();

comment on column public.commercial_opportunities.temperature is
  'Temperatura explicável do lead: cold, warm ou hot. Não ativa automação.';
comment on column public.commercial_opportunities.temperature_reason is
  'Motivo operacional da temperatura comercial.';
comment on column public.commercial_opportunities.lead_kind is
  'Separa novo negócio, cliente existente, suporte, financeiro, parceria e outros.';

-- Garantia explícita: esta migration não altera commercial_settings.ai_mode.
