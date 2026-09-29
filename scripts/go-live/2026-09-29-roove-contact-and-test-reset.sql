-- Duas correções de dado pontuais para a Roove — NÃO EXECUTADO AUTOMATICAMENTE. Revisar e rodar
-- manualmente (npx supabase db query --linked --file ...). Nenhuma delas mexe em financeiro
-- estrutural, contratos ou valores.

-- =====================================================================================
-- PARTE 1 — Roove financeira canônica: vincular o novo billing_contact_phone
-- =====================================================================================
-- Contexto: clients.billing_contact_phone da Roove canônica (e7919cd3-c989-49c9-994f-eb31aa9ce294)
-- já foi atualizado para 5511991256145, mas ainda não existe whatsapp_contacts para esse número —
-- ninguém mandou mensagem para ele ainda. O fluxo de produto (start_template_conversation /
-- collection-notification-worker, via persistOutboundMessage) já cria esse contato sozinho, com
-- client_id correto, na primeira cobrança enviada — CONFIRMADO por auditoria de código, não é preciso
-- consertar o fluxo. As duas únicas correções de código feitas nesta tarefa (mugozap-api.ts e
-- collection-notification-worker/index.ts) garantem que esse INSERT abaixo não seja depois
-- sobrescrito pelo fluxo automático: o upsert de contato agora preserva display_name já existente.
--
-- Este INSERT serve só para adiantar o apelido interno "Cleber o querido" ANTES do primeiro envio,
-- para já aparecer correto na Caixa de Entrada. Idempotente (upsert por connection_id+wa_id).

-- Passo 1 — conferir antes (conexão ativa da organização, e confirmar que o contato realmente não existe):
SELECT id, phone_number_id, status FROM whatsapp_connections
WHERE organization_id='1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f' AND status IN ('active','degraded')
ORDER BY updated_at DESC LIMIT 1;

SELECT * FROM whatsapp_contacts
WHERE organization_id='1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f' AND wa_id='5511991256145';

-- Passo 2 — criar o contato adiantado (troque :connection_id pelo id retornado no Passo 1):
INSERT INTO public.whatsapp_contacts (organization_id, connection_id, wa_id, client_id, display_name, contact_type, last_seen_at)
VALUES ('1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f', :connection_id, '5511991256145', 'e7919cd3-c989-49c9-994f-eb31aa9ce294', 'Cleber o querido', 'customer', now())
ON CONFLICT (connection_id, wa_id) DO UPDATE SET client_id=excluded.client_id, display_name=excluded.display_name
WHERE whatsapp_contacts.display_name IS NULL;
-- Nota: profile_name (nome do WhatsApp do contato, vindo da Meta) não é tocado — só display_name
-- (rótulo interno do CRM), exatamente como pedido.

-- =====================================================================================
-- PARTE 2 — Liberar o número de teste (5511974858863) para reuso como lead externo
-- =====================================================================================
-- Constraint real de attendance_mode confirmada via pg_constraint antes de qualquer UPDATE:
--   whatsapp_conversations_attendance_check: attendance_mode IN ('bot','human','paused')
-- Estado atual da conversation 09a6137e-a50d-43cb-8305-58f696701d16 (handoff real, não stale):
--   status=open, attendance_mode=human, automation_paused=true,
--   assigned_team_member_id=<Julia>, handoff_reason=manual_commercial_handoff
-- Por ter assigned_team_member_id preenchido, o reset automático de pausa "stale" do webhook (que só
-- reabre quando NÃO há dono atribuído) nunca mexeria aqui sozinho — é intencional, protege handoffs
-- reais. Como este é explicitamente um encerramento de teste (não um handoff real em andamento), o
-- reset abaixo é seguro e deliberado, feito uma única vez.
--
-- Não apaga mensagens nem a conversation em si — só reabre para bot, preservando 100% do histórico
-- para auditoria futura (nada é deletado).

-- Passo 1 — conferir o estado atual antes de aplicar:
SELECT id, wa_id, status, attendance_mode, automation_paused, handoff_reason, handoff_at, assigned_team_member_id
FROM whatsapp_conversations WHERE id='09a6137e-a50d-43cb-8305-58f696701d16';

-- Passo 2 — reset seguro (mesmos valores que o próprio código usa para reabertura, válidos pela constraint):
UPDATE public.whatsapp_conversations
SET attendance_mode='bot', automation_paused=false, handoff_reason=null, handoff_at=null, assigned_team_member_id=null
WHERE id='09a6137e-a50d-43cb-8305-58f696701d16'
  AND organization_id='1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f';

-- Passo 3 — confirmar:
SELECT id, wa_id, status, attendance_mode, automation_paused, handoff_reason, assigned_team_member_id
FROM whatsapp_conversations WHERE id='09a6137e-a50d-43cb-8305-58f696701d16';
