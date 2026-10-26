-- Lembretes de prospecção pelo WhatsApp (a Secretária manda o próximo convite pronto para colar no LinkedIn)
-- e pesquisa automática da planilha aos poucos. Aplicar pelo SQL Editor;
-- depois: npx supabase migration repair --status applied 202610260003
alter table public.outreach_settings add column if not exists prospector_member_id uuid references public.team_members(id) on delete set null;
alter table public.outreach_settings add column if not exists linkedin_reminders_enabled boolean not null default false;
alter table public.outreach_settings add column if not exists linkedin_reminder_times text[] not null default array['09:00','10:30','14:00','15:30','17:00'];
alter table public.outreach_settings add column if not exists auto_research_enabled boolean not null default true;
alter table public.prospects add column if not exists linkedin_reminded_at timestamptz;
create index if not exists prospects_linkedin_queue_idx on public.prospects(organization_id, linkedin_state, fit_score desc) where research_status = 'done';
