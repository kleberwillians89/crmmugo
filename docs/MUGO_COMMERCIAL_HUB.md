# CRMugo — núcleo comercial no WhatsApp

## O que foi implementado

O número central da Mugô passa a aceitar dois fluxos sem criar outro CRM:

- clientes e leads externos entram no atendimento comercial assistido;
- membros internos continuam usando os comandos operacionais do Mugô Tasks.

O webhook identifica primeiro um remetente interno. Só mensagens externas de uma organização com `commercial_settings.ai_mode = 'controlled_auto'` entram na fila comercial. Assim, o novo agente não concorre com a automação legada.

O fluxo comercial cria ou reutiliza o cliente por telefone e, quando aprendido, por e-mail; mantém uma única oportunidade aberta por conversa; registra qualificação, resumo e origem; responde pelo mesmo número; cria follow-up; e pausa a IA no handoff humano.

## Modelo de dados

A migration `202609210002_commercial_hub.sql` adiciona, sem substituir tabelas existentes:

- `commercial_settings`: ativação por tenant, responsável real, regras e preços autorizados;
- `commercial_opportunities`: funil anterior à proposta real;
- `commercial_qualifications`: diagnóstico estruturado e explicável;
- `conversation_summaries`: memória curta auditável;
- `commercial_ai_events`: fila idempotente da IA;
- `commercial_notification_outbox`: notificação confiável do handoff;
- `commercial_briefing_outbox`: criação do briefing no Notion somente sob demanda.

`clients` continua sendo a fonte do contato/empresa. `proposals` continua sendo proposta real. `crm_tasks` recebe `opportunity_id` e `task_type`. Todas as tabelas novas têm RLS, filtro por `organization_id` e validação de referências entre tenants.

## Handoff para Julia

O responsável não é inferido pelo nome nem gravado no frontend. Configure `commercial_owner_id` com o ID real de Julia em `team_members`. O backend resolve também `auth_profile_id` para que a conversa fique atribuída corretamente na caixa de entrada.

No handoff, uma única operação lógica:

1. marca a oportunidade como qualificada e atribui Julia;
2. muda a conversa para atendimento humano e pausa a IA;
3. registra o evento auditável;
4. cria a tarefa comercial idempotente, elegível para Trello;
5. enfileira a notificação no WhatsApp da Julia;
6. mantém no CRM o resumo, a origem, o interesse e o próximo passo.

O worker tenta `COMMERCIAL_WHATSAPP_PRIMARY`. Só após três falhas confirmadas muda para `COMMERCIAL_WHATSAPP_FALLBACK`. Resultado desconhecido de rede vai para dead letter e não é reenviado automaticamente, evitando mensagem duplicada.

## Secrets do backend

Configure apenas como secrets das Edge Functions; nunca use prefixo `VITE_`:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
META_ACCESS_TOKEN
GRAPH_API_VERSION
OPENAI_API_KEY
COMMERCIAL_AI_MODEL
COMMERCIAL_AI_WORKER_KEY
COMMERCIAL_NOTIFICATION_WORKER_KEY
COMMERCIAL_INTEGRATION_WORKER_KEY
COMMERCIAL_WHATSAPP_PRIMARY=+5511973510549
COMMERCIAL_WHATSAPP_FALLBACK=+5511972769605
CRM_PUBLIC_URL
TASK_SYNC_WORKER_KEY
TRELLO_API_KEY
TRELLO_TOKEN
TRELLO_API_SECRET
TRELLO_WEBHOOK_CALLBACK_URL
NOTION_TOKEN
NOTION_WEBHOOK_VERIFICATION_TOKEN
NOTION_API_VERSION
```

## Ativação segura

Depois de aplicar as migrations e publicar as funções, encontre Julia na organização correta e faça a configuração por ID:

```sql
select id, organization_id, auth_profile_id, name, email
from public.team_members
where active is true and name ilike '%julia%';

insert into public.commercial_settings(
  organization_id, ai_mode, commercial_owner_id, fallback_enabled
)
values ('ORGANIZATION_UUID', 'controlled_auto', 'JULIA_TEAM_MEMBER_UUID', true)
on conflict (organization_id) do update set
  ai_mode = excluded.ai_mode,
  commercial_owner_id = excluded.commercial_owner_id,
  fallback_enabled = excluded.fallback_enabled;
```

Comece com `ai_mode = 'disabled'`, valide a interface e os workers, e só então altere para `controlled_auto`. Sem `commercial_owner_id`, o sistema não deve ser ativado em produção.

Agende POSTs curtos, idealmente a cada minuto, para:

- `commercial-ai-worker`, com `X-Commercial-AI-Worker-Key`;
- `commercial-notification-worker`, com `X-Commercial-Notification-Worker-Key`;
- `commercial-integration-worker`, com `X-Commercial-Integration-Worker-Key`;
- `task-sync-worker`, com `X-Task-Sync-Worker-Key`.

Use Supabase Scheduled Functions, `pg_cron` + `pg_net` ou um cron externo. As funções públicas de worker estão com `verify_jwt = false`, mas exigem suas chaves compartilhadas. `commercial-actions` mantém JWT Supabase e valida perfil ativo com papel `admin` ou `manager`.

## Trello e Notion

Tarefas só saem do CRM quando `metadata.sync_external = true`, quando já existe vínculo externo, ou quando a integração opta explicitamente por `configuration.sync_all = true`. Handoff e follow-up comercial são relevantes; tarefas internas comuns não são enviadas por padrão.

O briefing do Notion não é criado para todo lead. O botão só fica disponível em oportunidade qualificada, e o backend repete essa validação. Na configuração da integração Notion, use `briefing_database_id` e, se os nomes forem diferentes, `briefing_properties`.

## Cenário de homologação

1. Envie “Oi, queria conhecer o trabalho de vocês”. Confirme contato, cliente e oportunidade em atendimento, sem handoff precoce.
2. Envie “Preciso de um site integrado ao CRM e WhatsApp”. Confirme os quatro interesses, resumo e qualificação progressiva.
3. Informe empresa, problema, objetivo e prazo. Confirme atualização da mesma oportunidade, sem duplicar cliente.
4. Envie “Quero uma proposta e falar com alguém”. Confirme pausa da IA, atribuição à Julia, tarefa e uma única notificação.
5. Simule falha confirmada no primário. Confirme retries e uso do fallback somente após a terceira falha.
6. Abra a conversa pelo link da notificação. Confirme o contexto lateral e o botão de handoff.
7. Gere o briefing. Confirme uma página no Notion e idempotência em cliques repetidos.
8. Conclua a tarefa no CRM e valide a projeção no Trello. Depois valide retorno assinado do webhook.
9. Repita com usuário de outro tenant e confirme ausência de leitura/escrita cruzada.

## Verificações locais

```bash
npm run test:commercial
npm run test:operational-hub
npm run test:crm
npm run test:whatsapp
npm run test:whatsapp-automation
npm run lint
npm run build
```

O teste comercial cobre classificação, deduplicação, handoff, fallback, idempotência, RLS, sincronização seletiva e briefing sob demanda. A homologação real ainda depende das credenciais Meta/OpenAI/Trello/Notion e da publicação das migrations/functions; nada é ativado automaticamente por este patch.
