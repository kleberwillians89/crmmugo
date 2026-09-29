import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const migration = fs.readFileSync('supabase/migrations/202609250006_whatsapp_trigger_safe_row_access.sql', 'utf8')
const ledgerMigration = fs.readFileSync('supabase/migrations/202609250003_whatsapp_trigger_and_ledger_recovery.sql', 'utf8')
const webhook = fs.readFileSync('supabase/functions/whatsapp-webhook/index.ts', 'utf8')
const hardening = fs.readFileSync('supabase/migrations/202608310004_whatsapp_operational_hardening.sql', 'utf8')

function functionBody(source, name) {
  const start = source.indexOf(`function public.${name}`)
  assert.ok(start > -1, `function ${name} not found`)
  const end = source.indexOf('\n$$;', start) > -1 ? source.indexOf('\n$$;', start) : source.indexOf('\n$function$', start)
  return source.slice(start, end)
}

test('causa raiz: as duas funções passam a ler campos opcionais só via to_jsonb(new), nunca new.<campo> direto', () => {
  const mugo = functionBody(migration, 'protect_mugo_operational_tenant')
  const wa = functionBody(migration, 'protect_whatsapp_operational_tenant')
  assert.ok(mugo.includes('to_jsonb(new)'))
  assert.ok(wa.includes('to_jsonb(new)'))
  // nenhum acesso direto e inseguro aos campos que não existem em todas as tabelas do gatilho
  for (const unsafe of ['new.task_id', 'new.connection_id', 'new.team_member_id', 'new.assigned_team_member_id']) {
    assert.doesNotMatch(mugo, new RegExp(unsafe.replace('.', '\\.')), unsafe)
  }
  for (const unsafe of ['new.contact_id', 'new.conversation_id', 'new.connection_id']) {
    assert.doesNotMatch(wa, new RegExp(unsafe.replace('.', '\\.')), unsafe)
  }
  // organization_id é comum a todas as tabelas do gatilho; acesso direto continua seguro
  assert.ok(mugo.includes('new.organization_id') === false || mugo.includes("new_row ->> 'organization_id'"))
  assert.ok(wa.includes("new_row ->> 'organization_id'") || wa.includes('new.organization_id') === false)
  assert.ok(migration.includes("pg_get_functiondef('public.protect_mugo_operational_tenant()'::regprocedure)"))
  assert.ok(migration.includes("pg_get_functiondef('public.protect_whatsapp_operational_tenant()'::regprocedure)"))
})

test('1-3: whatsapp_contacts, whatsapp_conversations e whatsapp_messages continuam com a mesma validação de tenant', () => {
  const mugo = functionBody(migration, 'protect_mugo_operational_tenant')
  assert.match(mugo,/tg_table_name in \('whatsapp_messages',\s*'whatsapp_contacts'\)/)
  assert.ok(mugo.includes("tg_table_name = 'whatsapp_conversations'"))
  assert.ok(mugo.includes('Member tenant mismatch'))
  assert.ok(mugo.includes('Assignee tenant mismatch'))
  const wa = functionBody(migration, 'protect_whatsapp_operational_tenant')
  assert.ok(wa.includes("tg_table_name = 'whatsapp_conversations'"))
  assert.ok(wa.includes('WhatsApp tenant mismatch'))
})

test('4: mark_whatsapp_conversation_read não referencia campo de risco do gatilho — herda a correção via trigger', () => {
  const rpc = functionBody(hardening, 'mark_whatsapp_conversation_read')
  // conversation_id aparece legitimamente como nome do parâmetro (p_conversation_id); o que importa
  // é que a função em si não toca team_member_id/assigned_team_member_id/contact_id (não são dela).
  for (const risky of ['team_member_id', 'assigned_team_member_id', 'contact_id']) {
    assert.doesNotMatch(rpc, new RegExp(risky))
  }
  assert.ok(rpc.includes('update public.whatsapp_conversations'))
  assert.ok(rpc.includes('set unread_count = 0'))
})

test('5-6: membro interno exige team_member válido; contato externo (sem team_member_id) não é bloqueado', () => {
  const mugo = functionBody(migration, 'protect_mugo_operational_tenant')
  assert.match(mugo, /v_member_id is null[\s\S]{0,60}or not exists/)
  assert.match(mugo, /tg_table_name in \('whatsapp_messages',\s*'whatsapp_contacts'\) and v_member_id is not null/)
})

test('7: tabelas sem team_member_id/connection_id (task_external_links, task_sync_outbox) só usam task_id', () => {
  const mugo = functionBody(migration, 'protect_mugo_operational_tenant')
  const branch = mugo.match(/tg_table_name in \('task_external_links',\s*'task_sync_outbox'\)[\s\S]*?(?=elsif)/)?.[0]||''
  assert.ok(branch.includes('v_task_id'))
  assert.doesNotMatch(branch, /v_member_id|v_connection_id|v_assigned_member_id/)
})

test('8: tabelas sem assigned_team_member_id não quebram — só whatsapp_conversations referencia esse ramo', () => {
  const mugo = functionBody(migration, 'protect_mugo_operational_tenant')
  const occurrences = (mugo.match(/v_assigned_member_id/g) || []).length
  assert.ok(occurrences >= 2) // declaração + uso no ramo whatsapp_conversations
  assert.match(mugo, /tg_table_name = 'whatsapp_conversations' and v_assigned_member_id is not null/)
})

test('9-10: tabelas sem contact_id/conversation_id não quebram protect_whatsapp_operational_tenant', () => {
  const wa = functionBody(migration, 'protect_whatsapp_operational_tenant')
  assert.ok(wa.includes('v_contact_id'))
  assert.ok(wa.includes('v_conversation_id'))
  assert.match(wa, /if tg_table_name = 'whatsapp_conversations' then[\s\S]*?where id = v_contact_id/)
  assert.match(wa, /else[\s\S]*?where id = v_conversation_id/)
})

test('11-12: ledger do webhook — completed nunca reprocessa, failed sempre pode reprocessar', () => {
  assert.ok(webhook.includes("if (existing.data.processing_status === 'completed') return { claimed: false"))
  assert.ok(webhook.includes("const recent = existing.data.processing_status === 'processing'"))
  assert.ok(webhook.includes('if (recent) return { claimed: false'))
  // fora do caminho completed/processing-recente, o código sempre tenta reclamar (failed e processing velho inclusos)
  assert.ok(webhook.includes('attempts: Number(existing.data.attempts || 0) + 1'))
  // reclaim usa optimistic locking por updated_at para evitar corrida entre duas reclamações concorrentes
  assert.ok(webhook.includes(".eq('updated_at', existing.data.updated_at)"))
})

test('estados do ledger: only completed/processing/failed/received são aceitos; regra e comentário documentados', () => {
  assert.ok(ledgerMigration.includes("check (processing_status in ('received','processing','completed','failed'))"))
  assert.ok(ledgerMigration.includes('somente completed torna uma entrega duplicada descartável'))
})

test('reconcile_whatsapp_message_status só considera webhook events já completed (evita reconciliar com status ainda em voo)', () => {
  const fn = functionBody(ledgerMigration, 'reconcile_whatsapp_message_status')
  assert.ok(fn.includes("processing_status = 'completed'"))
})

test('falha no processamento marca failed (não completed) e propaga o erro — Meta pode reentregar com segurança', () => {
  assert.match(webhook, /catch \(error\) \{\s*await failWebhookEvent\(admin, ledger\.id, error\)\s*throw error/)
  assert.match(webhook, /catch\(error\)\s*\{\s*await failWebhookEvent\(admin,ledger\.id,error\)\s*throw error/)
})

test('sem regressão de escopo: migration não altera financeiro, contratos, valores de clientes nem UI', () => {
  assert.doesNotMatch(migration, /\bdelete\s+from\b/i)
  assert.doesNotMatch(migration, /invoice_installments|contracts|expenses|freelance_cash_movements|commercial_settings|ai_mode/i)
})
