# Central Operacional Mugô

## Arquitetura e fonte da verdade

O CRM/Supabase é canônico. WhatsApp, Trello e Notion são superfícies conectadas:

```text
WhatsApp (cliente) -> Inbox/automação/handoff -> CRM
WhatsApp (equipe)  -> task_command_events -> task-command-worker -> crm_tasks
Trello/Notion      <-> webhooks -> crm_tasks -> task_sync_outbox -> adapters
```

Não existe sincronização direta WhatsApp → Trello → Notion. Toda mutação entra no CRM, que então cria projeções assíncronas. `crm_tasks.id` continua sendo o identificador real; a interface e o WhatsApp exibem os seis primeiros caracteres como short ID (`#39FB6B`).

## Meu Dia

`/hoje` é a entrada operacional destacada no menu. A página existente foi evoluída com:

- tarefas do dia, altas, atrasadas e concluídas;
- filtros Minhas tarefas, Equipe, Atrasadas, Hoje, Próximos 7 dias e Concluídas;
- criação, edição, início, conclusão, responsável, prioridade, data e hora;
- resumo da Inbox, handoffs, bot e cobranças;
- carga diária da equipe e indicadores discretos de Trello/Notion.

A URL anterior `/intelligence/hoje` permanece como alias.

## Separação equipe/cliente

O webhook normaliza `message.from` e compara somente com `team_members.phone` ativos da mesma `organization_id`. A normalização aceita o DDI 55 e a variação brasileira com/sem nono dígito.

- membro ativo: mensagem recebe `sender_type=internal`, `team_member_id` e entra em `task_command_events`;
- qualquer outro telefone: recebe `sender_type=customer` e continua no pipeline `automation_events` existente.

O retorno antecipado após enfileirar o comando interno é a barreira que impede uma mensagem externa de executar comandos administrativos. A identificação nunca é global entre tenants.

## Comandos internos

O parser determinístico cobre criação/listagem/movimentação/conclusão/prioridade/atribuição de tarefas, atendimento, pausa/retomada do bot e cobranças. Frases não reconhecidas podem usar OpenAI server-side como fallback estruturado; IDs retornados pelo modelo não são confiados. Entidades são sempre resolvidas novamente no tenant.

O worker usa `America/Sao_Paulo`, retry exponencial, limite de tentativas e idempotência por `(connection_id, provider_message_id)`. Respostas são enviadas pelo mesmo número central da conexão e persistidas no histórico canônico. A resposta livre ocorre dentro da janela aberta pela própria mensagem inbound.

## Handoff humano

Os estados existentes foram preservados:

- bot ativo: `status=open`, `attendance_mode=bot`, `automation_paused=false`;
- aguardando humano: `status=pending`, `attendance_mode=human`, `automation_paused=true`;
- humano ativo: `status=open`, `attendance_mode=human`, `automation_paused=true`, responsável definido;
- encerrado: `status=closed` e `closed_at`.

Assumir, transferir, pausar, retomar e fechar continuam usando o número Mugô. Toda alteração grava `whatsapp_conversation_events`. `assigned_to` mantém compatibilidade com o usuário autenticado; `assigned_team_member_id` liga a operação ao membro da equipe.

## Trello e Notion

`task_external_links` mantém no máximo um objeto por tarefa/provedor e nunca descobre objetos pelo título. `task_sync_outbox` separa falhas: Trello pode entrar em retry enquanto Notion conclui normalmente. O hash do estado evita updates redundantes; uma trava parcial impede dois jobs simultâneos para a mesma tarefa/provedor.

Configuração não secreta por organização fica em `task_integration_settings.configuration`.

Trello:

```json
{"board_id":"...","todo_list_id":"...","in_progress_list_id":"...","completed_list_id":"..."}
```

Notion:

```json
{"database_id":"...","properties":{"title":"Tarefa","status":"Status","priority":"Prioridade","due":"Prazo"}}
```

Tokens nunca ficam nessa tabela nem no frontend. As Edge Functions usam `TRELLO_API_KEY`, `TRELLO_TOKEN` e `NOTION_TOKEN`.

## Webhooks e prevenção de loop

`trello-task-webhook` valida a assinatura oficial do Trello. `notion-task-webhook` responde ao handshake e valida `X-Notion-Signature`. Eventos entram no ledger `task_external_events`. O update em `crm_tasks` preserva `metadata.origin`; o trigger não reenfileira de volta ao provedor de origem, mas projeta para o outro. Eventos repetidos são descartados pela chave externa única.

## Segurança, RLS e segredos

Todas as tabelas novas têm `organization_id`, RLS forçada e leitura autenticada limitada a `current_organization_id()`. Escrita de filas e links é reservada ao `service_role`; somente administradores alteram configurações. Segredos aceitos são exclusivamente server-side:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
TASK_COMMAND_WORKER_KEY
TASK_SYNC_WORKER_KEY
META_ACCESS_TOKEN
GRAPH_API_VERSION
OPENAI_API_KEY (opcional)
TASK_COMMAND_MODEL (opcional)
TRELLO_API_KEY
TRELLO_TOKEN
TRELLO_API_SECRET
TRELLO_WEBHOOK_CALLBACK_URL
NOTION_TOKEN
NOTION_WEBHOOK_VERIFICATION_TOKEN
NOTION_API_VERSION (opcional)
```

## Aplicação e deploy manual

Nada deste trabalho faz push, deploy, registra webhook ou muda credenciais automaticamente. Depois de revisar e selecionar o projeto Supabase correto:

```bash
supabase db push
supabase functions deploy whatsapp-webhook
supabase functions deploy whatsapp-automation-worker
supabase functions deploy task-command-worker
supabase functions deploy task-sync-worker
supabase functions deploy trello-task-webhook --no-verify-jwt
supabase functions deploy notion-task-webhook --no-verify-jwt
```

Cadastre secrets com `supabase secrets set NOME=valor`. Agende POSTs curtos para `task-command-worker` e `task-sync-worker` (por exemplo, a cada minuto), enviando respectivamente `X-Task-Command-Worker-Key` e `X-Task-Sync-Worker-Key`. Use pg_cron + pg_net, Supabase Scheduled Functions ou cron externo; mantenha uma única execução concorrente por worker.

Registre os webhooks externos apenas depois do deploy. A callback Trello configurada no secret deve ser byte a byte a mesma URL registrada, pois participa da assinatura.

## Templates, resumos e janela Meta

Os nomes `mugo_daily_tasks`, `mugo_handoff_alert`, `mugo_pending_tasks` e `mugo_daily_summary` estão reservados para futura ativação, mas aprovação não é presumida. O worker responde comandos recebidos na janela de 24 horas. Resumos proativos e alertas fora dela precisam usar template aprovado e devem ser agendados como novos eventos duráveis; tarefas pendentes não são movidas automaticamente no fechamento diário.

## Testes

```bash
npm run test:operational-hub
npm run test:crm
npm run test:whatsapp
npm run lint
npm run build
```

O teste novo cobre normalização/identidade, intents determinísticos, datas em São Paulo, short ID, barreira internal/external, escopo de tenant e constraints de idempotência.

## Rollback e troubleshooting

Rollback operacional seguro: desabilite Trello/Notion em `task_integration_settings`, pause os dois schedulers e restaure o deploy anterior das funções. Não apague `crm_tasks`, links ou outbox: eles são necessários para auditoria e retomada. A UI segue funcional sem credenciais externas.

- comando não processado: consulte `task_command_events.status/error_code`;
- sync parado: consulte `task_sync_outbox`, `task_external_links.last_error` e o card de Integrações;
- duplicidade externa: não crie vínculo por título; corrija o único registro em `task_external_links` após confirmar o objeto correto;
- webhook repetido: confira `task_external_events` e a assinatura/callback;
- membro tratado como cliente: normalize e corrija `team_members.phone`, confirme `active=true` e a organização;
- erro de schema cache após migration: aguarde/recarregue o cache da API antes de testar o webhook.
