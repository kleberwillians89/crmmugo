-- Feedback is reviewed evidence, never an automatic prompt/training update. Apply manually.
begin;
create table public.conversation_feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  conversation_id uuid not null references public.whatsapp_conversations(id),
  source_kind text check(source_kind in ('internal','commercial')),
  source_event_id uuid,
  label text not null check(label in ('correct','partially_correct','incorrect','intent_wrong','entity_wrong','context_wrong','response_poor','tool_wrong')),
  note text not null default '' check(length(note)<=2000),
  expected_outcome jsonb not null default '{}'::jsonb,
  reviewer_id uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  check((source_kind is null)=(source_event_id is null))
);
alter table public.conversation_feedback enable row level security;
create policy conversation_feedback_read on public.conversation_feedback for select to authenticated
  using(organization_id=public.current_organization_id() and public.is_active_user());
create policy conversation_feedback_insert on public.conversation_feedback for insert to authenticated
  with check(organization_id=public.current_organization_id() and public.is_active_user() and reviewer_id=auth.uid());
revoke all on public.conversation_feedback from anon,authenticated;
grant select,insert on public.conversation_feedback to authenticated;
grant all on public.conversation_feedback to service_role;
create function public.protect_conversation_feedback_scope() returns trigger language plpgsql set search_path='' as $$
begin
  if not exists(select 1 from public.whatsapp_conversations where id=new.conversation_id and organization_id=new.organization_id) then
    raise exception 'Feedback conversation tenant mismatch' using errcode='23514';
  end if;
  if new.source_kind='internal' and not exists(select 1 from public.task_command_events where id=new.source_event_id and organization_id=new.organization_id and conversation_id=new.conversation_id) then
    raise exception 'Feedback internal event scope mismatch' using errcode='23514';
  elsif new.source_kind='commercial' and not exists(select 1 from public.commercial_ai_events where id=new.source_event_id and organization_id=new.organization_id and conversation_id=new.conversation_id) then
    raise exception 'Feedback commercial event scope mismatch' using errcode='23514';
  end if;
  return new;
end $$;
create trigger protect_conversation_feedback_scope before insert or update on public.conversation_feedback
for each row execute function public.protect_conversation_feedback_scope();
create index conversation_feedback_review_idx on public.conversation_feedback(organization_id,created_at desc);
commit;
