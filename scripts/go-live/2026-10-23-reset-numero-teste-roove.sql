-- Libera o número de TESTE 5511974858863 ("Roove") para testar o atendimento do zero.
-- Nada é apagado: a conversa antiga é arquivada (fechada e com o número trocado por um código),
-- a oportunidade de teste vira "perdida" e as tarefas/alertas pendentes dela são encerrados.
-- O cliente Roove de verdade (cadastro de cliente) NÃO é alterado.
-- Na próxima mensagem desse número, o CRM cria contato e conversa novos, sem histórico.
-- Rode tudo de uma vez no SQL Editor.

begin;

with conv as (
  select id from public.whatsapp_conversations where wa_id = '5511974858863'
), lost as (
  update public.commercial_opportunities
  set stage = 'lost', lost_reason = 'Teste do atendimento (arquivado)'
  where conversation_id in (select id from conv) and stage not in ('won','lost')
  returning id
), tasks as (
  update public.crm_tasks set status = 'cancelled'
  where opportunity_id in (select id from lost) and status in ('pending','in_progress')
  returning id
), alerts as (
  update public.team_notification_outbox set status = 'completed', last_error = 'TEST_RESET'
  where status in ('pending','failed') and payload->>'conversation_id' in (select id::text from conv)
  returning id
)
select (select count(*) from conv) conversas, (select count(*) from lost) oportunidades_encerradas,
       (select count(*) from tasks) tarefas_canceladas, (select count(*) from alerts) alertas_encerrados;

-- Troca o número da conversa e do contato antigos por um código (9 + data/hora + final 8863).
update public.whatsapp_conversations
set wa_id = '9' || to_char(now() at time zone 'America/Sao_Paulo', 'MMDDHH24MI') || '8863',
    status = 'closed', attendance_mode = 'bot', automation_paused = false,
    assigned_team_member_id = null, handoff_at = null, handoff_reason = null
where wa_id = '5511974858863';

update public.whatsapp_contacts
set wa_id = '9' || to_char(now() at time zone 'America/Sao_Paulo', 'MMDDHH24MI') || '8863',
    display_name = left(coalesce(display_name, profile_name, 'Contato') || ' (teste arquivado)', 120)
where wa_id = '5511974858863';

commit;

-- Conferência: deve voltar vazio (o número está livre).
select id, wa_id, status from public.whatsapp_conversations where wa_id = '5511974858863';
