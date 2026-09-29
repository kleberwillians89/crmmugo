import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {parseInternalCommand} from '../supabase/functions/_shared/internalCommandCore.js'

const webhook=fs.readFileSync('supabase/functions/whatsapp-webhook/index.ts','utf8')
const worker=fs.readFileSync('supabase/functions/task-command-worker/index.ts','utf8')
const scheduler=fs.readFileSync('supabase/migrations/202609250002_task_command_worker_dispatch.sql','utf8')

test('webhook mantém a fila durável e dispara imediatamente o evento criado',()=>{
  assert.match(webhook,/task_command_events/)
  assert.match(webhook,/status: 'pending'/)
  // Dispara pelo id do evento realmente persistido: usa o registro recém-criado OU, em caso de
  // conflito de idempotência (23505, mesma provider_message_id já enfileirada), busca o existente
  // antes de despachar — nunca despacha um id nulo.
  assert.match(webhook,/dispatchTaskCommandWorker\(commandEventId\)/)
  assert.match(webhook,/let commandEventId\s*=\s*queuedCommand\.data\?\.id/)
  assert.match(webhook,/if\(!commandEventId\)\{/)
  assert.match(webhook,/\/functions\/v1\/task-command-worker/)
  assert.match(webhook,/'X-Task-Command-Worker-Key': workerKey/)
  assert.match(webhook,/Deno\.env\.get\('TASK_COMMAND_WORKER_KEY'\)/)
  assert.match(webhook,/event_id: eventId/)
  assert.doesNotMatch(webhook,/TASK_COMMAND_WORKER_KEY\s*=\s*['"][^'"]+/)
})

test('falha no dispatch não remove nem marca o evento como concluído',()=>{
  assert.match(webhook,/catch \{\s*return false\s*\}/)
  assert.doesNotMatch(webhook,/dispatchTaskCommandWorker[\s\S]{0,400}delete\(\)/i)
})

test('scheduler recupera a fila a cada minuto usando somente segredos do Vault',()=>{
  assert.match(scheduler,/cron\.schedule/)
  assert.match(scheduler,/'\* \* \* \* \*'/)
  for(const name of ['project_url','service_role_key','task_command_worker_key'])assert.match(scheduler,new RegExp(`name = '${name}'`))
  assert.match(scheduler,/'X-Task-Command-Worker-Key'/)
  assert.doesNotMatch(scheduler,/eyJ[A-Za-z0-9_-]{20,}/)
})

test('worker processa imediatamente só o event_id pedido e mantém lote para o cron',()=>{
  assert.match(worker,/if\(payload\?\.event_id\)dueQuery=dueQuery\.eq\('id'/)
  assert.match(worker,/limit\(payload\?\.event_id\?1:20\)/)
  assert.match(worker,/in\('status',\['pending','failed'\]\)/)
})

test('sessão entende “terminei” como conclusão da atividade anterior',()=>{
  const command=parseInternalCommand('terminei')
  assert.equal(command.intent,'ACTIVITY_COMPLETE')
  assert.equal(command.summary,null)
  assert.match(worker,/activity_summary/)
  assert.match(worker,/contextualActivity/)
  assert.match(worker,/Boa, registrei isso ✓/)
  assert.match(worker,/Fechado, registrei ✓/)
})

test('respostas principais são humanas, curtas e não expõem erro técnico',()=>{
  assert.match(worker,/Com o que foram os \$\{brl\(command\.amount\)\}\?/)
  assert.match(worker,/Hoje você tem:/)
  assert.match(worker,/Você não tem tarefas para hoje nem atrasadas\./)
  assert.match(worker,/candidate_items:taskModel\.candidateItems/)
  assert.match(worker,/Quer que eu abra as vencidas primeiro\?/)
  assert.match(worker,/Não consegui enviar agora porque o WhatsApp da Mugô está sem conexão com a Meta\./)
  assert.doesNotMatch(worker,/return [`'"]META_CONFIGURATION_MISSING/)
})
