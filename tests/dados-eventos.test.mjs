import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { contentTask, isDadosInviteReply } from '../supabase/functions/_shared/dadosBridgeCore.js'

const events = fs.readFileSync(new URL('../supabase/functions/dados-ops-events/index.ts', import.meta.url), 'utf8')
const webhook = fs.readFileSync(new URL('../supabase/functions/whatsapp-webhook/index.ts', import.meta.url), 'utf8')
const config = fs.readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8')

test('só responde ao Dados o clique em convite mugo_convite_*, nunca outro template', () => {
  assert.equal(isDadosInviteReply({ type: 'button', body: 'Sim, quero ver' }, 'mugo_convite_resumo'), true)
  assert.equal(isDadosInviteReply({ type: 'button', body: 'Já realizei o pagamento' }, 'mugo_alerta_pagamento_pendente'), false)
  assert.equal(isDadosInviteReply({ type: 'text', body: 'Sim' }, 'mugo_convite_resumo'), false)
  assert.equal(isDadosInviteReply({ type: 'button', body: 'Sim' }, null), false)
})

test('webhook: o clique do convite sai antes do robô comercial e do modo humano, e não se perde se o Dados falhar', () => {
  const hook = webhook.indexOf('isDadosInviteReply(content')
  assert.ok(hook > 0)
  assert.ok(hook < webhook.indexOf('const humanControlled'))
  assert.ok(hook < webhook.indexOf("from('commercial_ai_events')"))
  assert.match(webhook, /\.eq\('organization_id', connection\.organization_id\)\.eq\('provider_message_id', text\(message\.context\.id, 240\)\)/)
  assert.match(webhook, /kind: 'dados_reply_failed'/)
  assert.match(webhook, /for \(const timeout of \[70_000, 45_000\]\)/)
})

test('tarefa de conteúdo: título, prioridade e prazo certos; texto sem nada além do evento', () => {
  const adjust = contentTask({ action: 'ajuste_solicitado', title: 'Reels do Oud', comment: 'Trocar a música', actor_name: 'Nasser', scheduled_at: '2026-11-05T19:00:00-03:00' }, 'Curavino')
  assert.equal(adjust.title, 'CONTEÚDO — Ajustar · Curavino · Reels do Oud')
  assert.equal(adjust.priority, 'high')
  assert.equal(adjust.due_date, null)
  assert.match(adjust.notes, /Nasser pediu ajuste em "Reels do Oud"/)
  assert.match(adjust.notes, /Comentário: Trocar a música/)
  const ok = contentTask({ action: 'aprovado', title: 'Carrossel', scheduled_at: '2026-11-07T13:00:00-03:00' }, 'Roove')
  assert.equal(ok.due_date, '2026-11-07')
  assert.equal(contentTask({ action: 'apagar_tudo', title: 'x' }, 'Roove'), null)
  const edited = contentTask({ action: 'editado_pelo_cliente', title: 'Post', changes: ['legenda', 'data'] }, 'Roove')
  assert.match(edited.notes, /O que mudou: legenda, data/)
})

test('dados-ops-events: chave própria, tenant pelo external_integrations, idempotente e avisa o responsável', () => {
  assert.match(events, /if \(!expectedKey \|\| request\.headers\.get\('X-Dados-Ops-Key'\) !== expectedKey\) return json\(\{ ok: false, code: 'UNAUTHORIZED' \}, 401\)/)
  assert.match(events, /\.eq\('provider', 'mugo_dados'\)\.eq\('external_client_id', externalClientId\)\.eq\('status', 'active'\)\.maybeSingle\(\)/)
  assert.doesNotMatch(events, /body\?\.(organization_id|client_id)|event\.(organization_id|client_id)/)
  assert.match(events, /source_ref: `dados-content:\$\{eventId\}`/)
  assert.match(events, /onConflict: 'organization_id,source_ref'/)
  assert.match(events, /idempotency_key: `task-assigned:\$\{saved\.data\.id\}`/)
  assert.match(events, /task_type: 'delivery'/)
  assert.match(config, /\[functions\.dados-ops-events\]\nverify_jwt = false/)
  const logs = [...events.matchAll(/console\.log\(JSON\.stringify\(\{([^}]*)\}\)\)/g)].map((m) => m[1])
  for (const line of logs) assert.doesNotMatch(line, /title|comment|notes|phone|name/)
})
