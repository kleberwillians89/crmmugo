# Lembretes de tarefa — ativação manual

Nada neste conjunto publica funções, aplica SQL remoto, altera secrets ou ativa cron automaticamente.

## Ordem de ativação

1. Revisar/aplicar `supabase/migrations/202609300001_task_reminders.sql`. A migration agenda tarefas futuras com horário, mas não envia nada.
2. Garantir que o template `mugo_lembrete_tarefa`, idioma `pt_BR`, categoria `UTILITY`, esteja aprovado na Meta e sincronizado como `APPROVED` / `is_active=true` em `whatsapp_message_templates`, no WABA correto. Este código não cria nem aprova templates.
3. Configurar manualmente `TASK_REMINDER_WORKER_KEY` na Edge Function e o mesmo valor no Vault como `task_reminder_worker_key`. Reutilizar `META_ACCESS_TOKEN`, `GRAPH_API_VERSION`, `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` existentes. Não trocar a conexão Meta.
4. Publicar manualmente `task-reminder-worker`. Publicar a UI somente depois da migration.
5. Usar POST autenticado por `X-Task-Reminder-Worker-Key` com `{"source":"manual-demo"}` ou `{"source":"manual-demo","reminder_id":"UUID_REAL"}`. O filtro não ignora horário, template, elegibilidade ou idempotência. Não são criados dados de demonstração.
6. Após conferir a entrega real, aplicar manualmente `2026-09-30-activate-task-reminder-cron.sql`. Somente o job `crmugo-task-reminder-worker` é alterado, com frequência de cinco minutos.

Corpo esperado do template (três parâmetros de texto):

```text
Olá, {{1}}!

Lembrete da sua agenda Mugô:

{{2}}

Horário: {{3}}

Começa em 1 hora.
```

## Decisões operacionais

- Instantes são calculados pelo PostgreSQL com `AT TIME ZONE 'America/Sao_Paulo'`. A UI mantém o horário local.
- Tolerância do primeiro disparo: até dez minutos depois de `scheduled_for`. Não enviar o aviso de uma hora quando a tarefa foi criada a apenas trinta minutos do início. Retries de respostas explicitamente negativas da Meta podem ocorrer até antes de `due_at`.
- Chave única: `task-reminder:{task_id}:{due_at UTC}:60m`. Reagendamento cria nova chave e cancela a anterior. Troca de responsável cancela/rearma a mesma chave **ainda não despachada**, atualizando o destinatário e invalidando o claim anterior. Não há segundo envio para um horário já enviado, mesmo após troca de responsável. Essa restrição preserva a chave exigida e evita duplicidade.
- Claim: `FOR UPDATE SKIP LOCKED`, lote de até cinquenta; autorização final sob lock da tarefa e token do claim. Nenhum telefone vem do payload manual ou de IA.
- A outbox é o histórico de entrega do reminder. O worker não modifica sessões da Secretária, filas comerciais ou conversas existentes.
- Falhas temporárias conhecidas: 429/500/502/503 e falhas de leitura antes do envio. Esperas mínimas 2/5/10/20/30 minutos; a sexta falha é terminal. O cron de cinco minutos pode executar depois do instante mínimo de retry.
- Timeout/network **depois de iniciar o POST** não prova que a Meta recusou. Fica `blocked / PROVIDER_RESULT_UNKNOWN`, sem replay automático. Também bloqueamos claims abandonados que já iniciaram despacho. Isto prioriza não duplicar; não existe garantia de exactly-once entre PostgreSQL e uma API externa.
- Bloqueios por template, telefone ou conexão precisam de revisão após corrigir a causa. Nunca rearmar resultado desconhecido ou envio confirmado sem reconciliar a entrega.

## Auditoria somente leitura

```sql
select id, organization_id, task_id, team_member_id, due_at, scheduled_for,
       status, attempts, next_attempt_at, error_code, provider_message_id, sent_at
from public.task_reminder_outbox
order by created_at desc
limit 50;
```

## Validação local

`node --test tests/task-reminder-worker.test.mjs tests/task-reminder-postgres.test.mjs`

O segundo teste sobe PostgreSQL temporário em socket Unix privado, aplica a migration em fixture mínima, testa concorrência/RLS/triggers e remove somente seu diretório temporário. Não usa credenciais Supabase nem banco remoto. Em ambiente sem binários PostgreSQL, informa skip.
