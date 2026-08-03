# Auditoria de arquitetura WhatsApp e preparação para automações

Data da auditoria: 2026-07-28

Escopo analisado:

- `crm.mugoagencia`, no workspace atual.
- `mugozap-backend`, fornecido no arquivo `mugozap 2.zip`. Para as referências abaixo, o prefixo `mugozap-backend/` corresponde a `mugo-zap/` dentro do arquivo.

Esta é uma auditoria estática. Nenhum serviço foi iniciado, nenhuma chamada externa foi feita e nenhum código funcional, banco, secret, Edge Function ou migration foi alterado. Valores de secrets não foram lidos nem reproduzidos.

## Convenções de evidência

- **Fato confirmado**: comportamento presente no código ou nas migrations fornecidas.
- **Hipótese**: inferência que depende do ambiente implantado, de schema anterior não incluído ou de comportamento externo.
- Referências usam `arquivo:linha` ou `arquivo:linha-linha`.

## 1. Resumo executivo

O sistema atual possui duas fronteiras de aplicação:

1. O CRM React usa autenticação Supabase, resolve o perfil e a organização e chama uma única Edge Function por um envelope `{operation, payload}`. A Edge autentica novamente o JWT, lê `profiles.organization_id`, autoriza por papel e encaminha operações para o MugoZap com uma chave de painel. **Fato confirmado** (`src/services/data/whatsappRepository.js:89-121`, `supabase/functions/mugozap-api/index.ts:255-287`).
2. O MugoZap é uma API FastAPI que mantém conversas, mensagens, tarefas, estados de IA e fluxos no Supabase, envia mensagens pela Graph API e recebe webhooks da Meta. **Fato confirmado** (`mugozap-backend/server/app.py:46-70`, `mugozap-backend/server/services/whatsapp.py:20-33`, `mugozap-backend/server/app.py:4769-4777`, `mugozap-backend/server/app.py:5001-5030`).

O atendimento individual funciona sobre uma arquitetura que ainda é parcialmente monocliente:

- A Edge usa `organization_id`; o MugoZap usa `workspace_id`. Não existe no código auditado um vínculo canônico e persistido entre esses identificadores. **Fato confirmado** (`supabase/functions/mugozap-api/index.ts:277-287`, `mugozap-backend/server/services/workspace.py:38-58`).
- O webhook inbound do MugoZap escolhe o workspace padrão, sem usar o `phone_number_id` recebido para descobrir o tenant. Isso impede conectar várias contas WhatsApp com isolamento correto. **Fato confirmado** (`mugozap-backend/server/app.py:5086-5094`).
- A Edge e o MugoZap consultam templates diretamente na Meta, cada um com seus próprios secrets. Isso cria duas fontes operacionais de verdade para WABA, versão e token. **Fato confirmado** (`supabase/functions/mugozap-api/index.ts:122-175`, `mugozap-backend/server/services/whatsapp.py:20-59`).
- A Edge exige chave de idempotência, mas o MugoZap ignora esse campo nos dois endpoints de envio. Um timeout entre os dois serviços ainda pode produzir duplicidade se o chamador repetir. **Fato confirmado** (`supabase/functions/mugozap-api/index.ts:427-454`, `mugozap-backend/server/app.py:3673-3676`, `mugozap-backend/server/app.py:3717-3729`).

## 2. Mapa da arquitetura atual

```text
Usuário
  │
  ▼
CRM React/Vite
  ├─ Supabase Auth + profiles + organization_id
  ├─ tabelas CRM: clientes, contratos, parcelas
  ├─ tabelas WhatsApp auxiliares: links, alertas, templates
  └─ supabase.functions.invoke("mugozap-api")
          │
          ▼
Supabase Edge Function mugozap-api
  ├─ valida JWT no Supabase
  ├─ valida profile, role e organization_id
  ├─ consulta/persiste templates diretamente na Meta + Supabase CRM
  └─ encaminha atendimento ao MugoZap com X-Panel-Key/X-Workspace-Id
          │
          ▼
MugoZap FastAPI
  ├─ autenticação Supabase ou PANEL_API_KEY
  ├─ workspace_id e perfis próprios
  ├─ conversas, mensagens, tarefas, IA e flow state
  ├─ envio via Meta Graph API
  └─ webhook Meta
          │
          ▼
Meta WhatsApp Cloud API
```

Evidências:

- Cliente Supabase e envelope da Edge: `src/services/data/whatsappRepository.js:89-121`.
- Rotas internas da Edge: `supabase/functions/mugozap-api/index.ts:211-236`.
- Validação de usuário e organização na Edge: `supabase/functions/mugozap-api/index.ts:260-287`.
- Autenticação MugoZap por chave ou JWT: `mugozap-backend/server/app.py:519-579`.
- Tabelas operacionais configuráveis do MugoZap: `mugozap-backend/server/app.py:46-70`.
- Cliente Meta do MugoZap: `mugozap-backend/server/services/whatsapp.py:20-33`, `mugozap-backend/server/services/whatsapp.py:282-338`.

## 3. Fluxo completo de envio

### 3.1 Mensagem livre

1. O CRM bloqueia visualmente a mensagem livre quando `serviceWindowOpen === false`, cria uma UUID e adiciona uma mensagem otimista. **Fato confirmado** (`src/components/WhatsAppPage.jsx:155-173`).
2. O repository normaliza o identificador e envia `send_manual_message` com `{waId, text, idempotencyKey}`. **Fato confirmado** (`src/services/data/whatsappRepository.js:236-240`).
3. A Edge transforma a operação em `POST /api/conversations/{waId}/send` e inclui `idempotency_key`. **Fato confirmado** (`supabase/functions/mugozap-api/index.ts:215-216`).
4. A Edge autentica o CRM, autoriza escrita para `admin` ou `manager`, valida identificador/texto/chave e chama o MugoZap. **Fato confirmado** (`supabase/functions/mugozap-api/index.ts:271-287`, `supabase/functions/mugozap-api/index.ts:456-473`).
5. O MugoZap autentica por `X-Panel-Key`, recebe o JSON, lê somente `text`, pausa a automação e chama `safe_send`. **Fato confirmado** (`mugozap-backend/server/app.py:527-548`, `mugozap-backend/server/app.py:3658-3705`).
6. `safe_send` termina em `send_message_detailed`, que monta o payload e faz `POST /{PHONE_NUMBER_ID}/messages` na Graph API. **Fato confirmado** (`mugozap-backend/server/services/whatsapp.py:247-305`).
7. O MugoZap registra a saída com `provider_message_id`; a Edge só considera confirmado quando encontra um identificador equivalente. **Fato confirmado** (`mugozap-backend/server/app.py:2838-2839`, `supabase/functions/mugozap-api/index.ts:528-531`).

Ruptura importante: o `idempotency_key` não é lido pelo endpoint MugoZap. **Fato confirmado** (`mugozap-backend/server/app.py:3673-3676`).

### 3.2 Template

1. O CRM monta `components`, gera UUID e chama `send_template_message` em modo `minimal`. **Fato confirmado** (`src/components/WhatsAppPage.jsx:219-235`).
2. A Edge valida allowlist, template ativo/APPROVED por `organization_id + WABA + name + language`, quantidade/tipos de parâmetros e idempotência. **Fato confirmado** (`supabase/functions/mugozap-api/index.ts:427-454`).
3. Em `minimal`, a Edge converte os parâmetros de BODY em uma lista plana e chama `POST /api/conversations/start-template`. **Fato confirmado** (`supabase/functions/mugozap-api/index.ts:447-454`).
4. O MugoZap restringe esse endpoint a `mugo_alerta_pagamento_pendente`, `pt_BR` e exatamente um parâmetro. **Fato confirmado** (`mugozap-backend/server/app.py:3708-3737`).
5. O MugoZap consulta o status na Meta, monta um template BODY-only e envia pela Graph API. **Fato confirmado** (`mugozap-backend/server/app.py:3730-3739`, `mugozap-backend/server/services/whatsapp.py:123-130`).
6. Após confirmação, MugoZap atualiza conversa/usuário e registra uma prévia local; a Edge exige `message_id` antes de responder sucesso. **Fato confirmado** (`mugozap-backend/server/app.py:3740-3745`, `supabase/functions/mugozap-api/index.ts:518-527`).

Consequência: o validador da Edge aceita HEADER, BODY, mídia, URL e COPY_CODE, mas o contrato efetivo do MugoZap só transforma BODY text em lista plana. **Fato confirmado** (`supabase/functions/mugozap-api/index.ts:48-87`, `mugozap-backend/server/services/whatsapp.py:123-130`).

## 4. Fluxo dos webhooks

### 4.1 Verificação

`GET /webhook` compara `hub.verify_token` com `WHATSAPP_VERIFY_TOKEN/VERIFY_TOKEN` e devolve o challenge. **Fato confirmado** (`mugozap-backend/server/app.py:35`, `mugozap-backend/server/app.py:4769-4777`).

### 4.2 Status de mensagem

1. `POST /webhook` detecta `value.statuses` e agenda `_process_status_webhook`. **Fato confirmado** (`mugozap-backend/server/app.py:5001-5023`).
2. São aceitos `sent`, `delivered`, `read` e `failed`. **Fato confirmado** (`mugozap-backend/server/app.py:5033-5052`).
3. A tabela de mensagens é atualizada pelo `provider_message_id`, incluindo timestamps, falha e pricing. **Fato confirmado** (`mugozap-backend/server/app.py:5053-5063`).
4. O CRM lê esses campos e normaliza o status para a UI. **Fato confirmado** (`src/services/data/whatsappRepository.js:163-191`).

### 4.3 Mensagem inbound

1. `POST /webhook` agenda `_process_webhook_payload`. **Fato confirmado** (`mugozap-backend/server/app.py:5025-5030`).
2. O processamento usa `resolve_workspace_id()` sem contexto da conta receptora, portanto cai no workspace padrão. **Fato confirmado** (`mugozap-backend/server/app.py:5086-5094`, `mugozap-backend/server/services/workspace.py:51-58`).
3. Há deduplicação por último `message_id` no estado da conversa. **Fato confirmado** (`mugozap-backend/server/app.py:5099-5103`; implementação em `mugozap-backend/server/app.py:2768-2785`).
4. Apenas `text` e `interactive` são processados; outros tipos são ignorados. **Fato confirmado** (`mugozap-backend/server/app.py:5118-5138`).
5. O usuário/conversa é atualizado, a mensagem é persistida e o fluxo decide entre atendimento humano, convite, IA ou automação. **Fato confirmado** (`mugozap-backend/server/app.py:5161-5221`, `mugozap-backend/server/app.py:5234-5285`).

### 4.4 Segurança do webhook

`META_APP_SECRET` só é reportado como presente; não há validação de `X-Hub-Signature-256` no webhook Meta. **Fato confirmado** (`mugozap-backend/server/services/whatsapp.py:96-107`, `mugozap-backend/server/app.py:5001-5030`; busca no backend encontra HMAC apenas nos webhooks internos em `mugozap-backend/server/app.py:4292`, `mugozap-backend/server/app.py:4324`, `mugozap-backend/server/app.py:4356`).

## 5. Endpoints existentes no MugoZap

Todos os endpoints abaixo são fatos confirmados em `mugozap-backend/server/app.py`.

| Método | Endpoint | Finalidade | Evidência |
| --- | --- | --- | --- |
| GET | `/health` | Saúde/configuração | `:3089-3095` |
| GET | `/api/me` | Usuário atual | `:3098-3109` |
| GET | `/api/users` | Listar perfis | `:3112-3129` |
| POST | `/api/users` | Criar perfil | `:3132-3155` |
| PATCH | `/api/users/{profile_id}` | Atualizar perfil | `:3158-3182` |
| GET | `/api/debug/ai-state/{wa_id}` | Estado de IA | `:3185-3199` |
| GET | `/api/debug/meta-env` | Presença de configuração Meta | `:3202-3218` |
| POST | `/api/debug/send-test-whatsapp/{wa_id}` | Envio de teste direto | `:3221-3251` |
| POST | `/api/jobs/run-followups` | Rodar follow-ups | `:3254` |
| GET | `/api/debug/lead-state/{wa_id}` | Diagnóstico do lead | `:3313` |
| POST | `/api/debug/reset-lead/{wa_id}` | Resetar lead | `:3369` |
| POST | `/api/debug/simulate-incoming/{wa_id}` | Simular inbound | `:3409` |
| GET | `/api/conversations` | Listar conversas | `:3548-3561` |
| GET | `/api/conversations/by-phone/{phone}` | Localizar conversa | `:3564-3579` |
| DELETE | `/api/conversations/{wa_id}` | Excluir bundle da conversa | `:3582-3607` |
| GET | `/api/messages` | Listar mensagens por `wa_id` | `:3610-3638` |
| GET | `/api/conversations/{wa_id}` | Detalhe/histórico | `:3641-3655` |
| POST | `/api/conversations/{wa_id}/send` | Mensagem livre | `:3658-3705` |
| POST | `/api/conversations/start-template` | Iniciar com template | `:3708-3745` |
| GET | `/api/templates/{template_name}` | Status de template | `:3748-3760` |
| GET | `/api/whatsapp/usage` | Uso/custo estimado | `:3763-3790` |
| POST | `/api/conversations/{wa_id}/handoff/close` | Fechar handoff | `:3811` |
| PATCH | `/api/conversations/{wa_id}` | Atualizar conversa | `:3890` |
| PATCH | `/api/attendance/conversations/{wa_id}/assign` | Atribuir atendente | `:3960` |
| PATCH | `/api/attendance/conversations/{wa_id}/status` | Alterar status | `:4009` |
| GET | `/api/tasks` | Listar tarefas | `:4055` |
| POST | `/api/tasks` | Criar tarefa | `:4080` |
| POST | `/api/tasks/{task_id}/done` | Concluir tarefa | `:4119` |
| PATCH | `/api/tasks/{task_id}` | Atualizar tarefa | `:4135` |
| GET | `/api/attendance/meta` | Filas/status/metadados | `:4161` |
| POST | `/api/integrations/mugo-intelligence/lead` | Integrar lead Intelligence | `:4284` |
| POST | `/webhooks/mugo-intelligence` | Webhook Intelligence | `:4316` |
| POST | `/api/integrations/mugo-welcome/lead` | Integrar lead Welcome | `:4348` |
| POST | `/api/attendance/conversations/{wa_id}/diagnosis` | Salvar diagnóstico | `:4458` |
| POST | `/api/attendance/contacts` | Criar/atualizar contato | `:4518` |
| POST | `/api/attendance/collections` | Registrar cobrança | `:4555` |
| POST | `/api/attendance/collections/{wa_id}/remind` | Lembrete de cobrança | `:4600` |
| GET | `/api/dashboard/summary` | Resumo do painel | `:4632` |
| POST | `/api/followups/run` | Executar follow-ups | `:4708` |
| GET | `/events` | Server-Sent Events | `:4723` |
| GET | `/webhook` | Verificação Meta | `:4769-4777` |
| POST | `/webhook` | Eventos Meta | `:5001-5030` |

Não foram encontrados endpoints de campanhas, públicos, consentimento/opt-out ou agendamento genérico. **Fato confirmado** pela enumeração completa dos decorators em `mugozap-backend/server/app.py:3089-5001`.

## 6. Operações existentes na Edge `mugozap-api`

| Operação | MugoZap/Meta | Mutação | Restrição |
| --- | --- | --- | --- |
| `health` | `GET /health` | não | autenticado |
| `list_conversations` | `GET /api/conversations` | não | autenticado |
| `find_conversation_by_phone` | `GET /api/conversations/by-phone/{phone}` | não | autenticado |
| `list_messages` | `GET /api/messages` | não | autenticado |
| `send_manual_message` | `POST /api/conversations/{waId}/send` | sim | admin/manager |
| `assign_conversation` | PATCH assign | sim | admin/manager |
| `pause_automation` | PATCH conversa | sim | admin/manager |
| `resume_automation` | POST handoff close | sim | admin/manager |
| `close_conversation` | PATCH conversa | sim | admin/manager |
| `get_attendance_meta` | `GET /api/attendance/meta` | não | autenticado |
| `list_users` | `GET /api/users` | não | admin |
| `get_dashboard_summary` | `GET /api/dashboard/summary` | não | autenticado |
| `start_template_conversation` | `POST /api/conversations/start-template` | sim | admin/manager |
| `send_template_message` | mesmo endpoint | sim | admin/manager + allowlist |
| `get_template_test_access` | consulta local | não | admin |
| `list_templates` | Supabase CRM | não | autenticado |
| `sync_templates` | Meta + Supabase CRM | sim | admin/manager |
| `get_template_status` | Meta | não | autenticado |
| `get_usage` | `GET /api/whatsapp/usage` | não | autenticado |

Fonte integral das rotas: `supabase/functions/mugozap-api/index.ts:211-236`. Autorização: `supabase/functions/mugozap-api/index.ts:271-291`.

Há contratos frontend para `batch_collection_alerts`, `mark_collection_negotiation` e `mark_installment_paid`, mas não há rotas correspondentes na Edge auditada. **Fato confirmado** (`src/services/whatsapp/operationContracts.js:18-20`, `supabase/functions/mugozap-api/index.ts:211-236`).

## 7. Tabelas Supabase relacionadas ao WhatsApp

### 7.1 No CRM

| Tabela | Papel | Chaves/vínculos |
| --- | --- | --- |
| `whatsapp_conversation_links` | Liga conversa MugoZap ao cliente CRM | `organization_id`, `client_id`, `wa_id`; únicos por organização/cliente e organização/wa_id |
| `whatsapp_collection_alerts` | Auditoria de alertas de cobrança | organização, cliente, parcela, contrato, template, provider ID e status |
| `whatsapp_message_templates` | Cache oficial dos templates Meta | organização, WABA, nome, idioma, status, components e payload bruto |

Evidências: `supabase/migrations/202607160001_whatsapp_collection_flow.sql:1-48`, `supabase/migrations/202607260001_whatsapp_template_sync_audit.sql:1-34`, `supabase/migrations/202607270001_whatsapp_templates_production.sql:1-38`.

As policies das três tabelas filtram por `current_organization_id()` e usuário ativo; escrita exige `can_write()`. **Fato confirmado** (`supabase/migrations/202607160001_whatsapp_collection_flow.sql:39-44`, `supabase/migrations/202607260001_whatsapp_template_sync_audit.sql:18-25`).

### 7.2 No Supabase usado pelo MugoZap

Tabelas referenciadas:

- `workspaces`
- `profiles`
- `whatsapp_users`
- `whatsapp_conversations`
- `whatsapp_messages`
- `whatsapp_tasks`
- `ai_state`
- `whatsapp_flow_state`/`flow_state`
- `settings`
- `whatsapp_pricing_rates`

Evidências de nomes configuráveis: `mugozap-backend/server/app.py:46-70`. Vínculo `workspace_id`: `mugozap-backend/supabase/migrations/20260317_multitenant_workspace.sql:3-89`. Perfis: `mugozap-backend/supabase/migrations/20260624_profiles_permissions.sql:5-24`. Pricing/status: `mugozap-backend/supabase/migrations/20260716_whatsapp_usage_pricing.sql:1-34`.

As migrations fornecidas alteram várias tabelas preexistentes, mas não contêm sua criação original. Portanto, colunas anteriores, constraints e RLS completas dessas tabelas não podem ser confirmadas por este arquivo ZIP. **Fato confirmado** (`mugozap-backend/supabase/migrations/20260317_multitenant_workspace.sql:21-89`). **Hipótese**: o schema-base foi criado fora do conjunto de migrations fornecido.

## 8. Vínculo entre organização, usuário, cliente, conversa e mensagem

### CRM

```text
auth.users.id
  └─ profiles.id → organization_id
       ├─ clients.organization_id
       ├─ whatsapp_conversation_links.organization_id
       │    ├─ client_id → clients.id
       │    └─ wa_id/conversation_id → identidade externa MugoZap
       ├─ whatsapp_collection_alerts
       │    ├─ client_id
       │    ├─ installment_id
       │    └─ provider_message_id
       └─ whatsapp_message_templates
            └─ waba_id + name + language
```

- O AuthContext busca `profiles` pelo mesmo UUID do usuário autenticado. **Fato confirmado** (`src/contexts/AuthContext.jsx:5`).
- A Edge lê `profiles.organization_id` pelo `user.id`. **Fato confirmado** (`supabase/functions/mugozap-api/index.ts:271-287`).
- O vínculo conversa-cliente é criado por `organization_id + wa_id`. **Fato confirmado** (`src/services/data/whatsappClientLinksRepository.js:18-35`).

### MugoZap

```text
Supabase user / PANEL_API_KEY
  └─ profile.workspace_id
       ├─ whatsapp_users(workspace_id, wa_id)
       ├─ whatsapp_conversations(workspace_id, wa_id)
       ├─ whatsapp_messages(workspace_id, wa_id, provider_message_id)
       ├─ whatsapp_tasks(workspace_id, wa_id)
       ├─ ai_state(workspace_id, wa_id)
       └─ flow_state(workspace_id, wa_id)
```

- `workspace_id + wa_id` é a identidade composta de usuário/conversa. **Fato confirmado** (`mugozap-backend/supabase/migrations/20260317_multitenant_workspace.sql:21-45`).
- Mensagens são consultadas por workspace, wa_id e data. **Fato confirmado** (`mugozap-backend/server/services/state.py:730-776`).
- Não existe foreign key confirmada entre `whatsapp_messages.wa_id` e uma conversa; a ligação é lógica por `workspace_id + wa_id`. **Fato confirmado** pela ausência dessa FK nas migrations fornecidas; **hipótese**: pode existir no schema-base ausente.

### Lacuna entre os projetos

Não há tabela confirmada `organization_id ↔ workspace_id ↔ WABA/phone_number_id`. Hoje o CRM envia `X-Workspace-Id` a partir de metadata do usuário, e o MugoZap aceita esse valor na autenticação por chave global. **Fato confirmado** (`src/services/data/whatsappRepository.js:99-106`, `mugozap-backend/server/app.py:519-548`).

## 9. Uso de WABA ID, Phone Number ID e tokens

### Edge/CRM

- `WABA_ID`, `PHONE_NUMBER_ID`, `META_ACCESS_TOKEN` e `GRAPH_API_VERSION` são secrets da Edge. **Fato confirmado** (`supabase/functions/mugozap-api/index.ts:122-133`).
- `WABA_ID` lista templates em `/{WABA_ID}/message_templates`. **Fato confirmado** (`supabase/functions/mugozap-api/index.ts:173-175`).
- O token é usado em `Authorization: Bearer`, com timeout de oito segundos. **Fato confirmado** (`supabase/functions/mugozap-api/index.ts:135-170`).
- `PHONE_NUMBER_ID` é validado pela configuração, mas o envio real passa pelo MugoZap. **Fato confirmado** (`supabase/functions/mugozap-api/index.ts:122-133`, `supabase/functions/mugozap-api/index.ts:211-236`).

### MugoZap

- `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID/PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID/WABA_ID` e `WHATSAPP_GRAPH_VERSION` são lidos do ambiente. **Fato confirmado** (`mugozap-backend/server/services/whatsapp.py:20-33`).
- WABA e token consultam templates. **Fato confirmado** (`mugozap-backend/server/services/whatsapp.py:36-59`).
- Phone Number ID e token enviam mensagens. **Fato confirmado** (`mugozap-backend/server/services/whatsapp.py:282-305`).
- O startup imprime o valor completo de `PANEL_API_KEY` e números operacionais; isso é exposição de segredo/PII em logs. **Fato confirmado** (`mugozap-backend/server/app.py:400-421`).

## 10. Funcionalidades duplicadas

| Função | CRM/Edge | MugoZap | Risco |
| --- | --- | --- | --- |
| Status de templates | Meta direta + cache `whatsapp_message_templates` | Meta direta em `get_template_status` | Configuração divergente |
| Autenticação/perfis | `profiles.organization_id` | `profiles.workspace_id` e allowlist de domínio | Papéis/tenants divergentes |
| Estado de cobrança | `whatsapp_collection_alerts` | campos/status em conversa e endpoints collections | Transições concorrentes |
| Vínculo de contato | `whatsapp_conversation_links` | `whatsapp_users`/`whatsapp_conversations` por telefone | Identidades órfãs |
| Status/custos | alertas CRM guardam delivered/read/cost | mensagens MugoZap guardam status/pricing | Métricas inconsistentes |
| Idempotência | Edge/alerta CRM | não aplicada nos sends MugoZap | Duplicidade em timeout |

Evidências principais: `supabase/functions/mugozap-api/index.ts:173-208`, `mugozap-backend/server/services/whatsapp.py:36-59`, `supabase/migrations/202607160001_whatsapp_collection_flow.sql:13-38`, `mugozap-backend/server/app.py:4555`, `supabase/migrations/20260716_whatsapp_usage_pricing.sql` não existe no CRM; equivalente no MugoZap em `mugozap-backend/supabase/migrations/20260716_whatsapp_usage_pricing.sql:1-34`.

## 11. Pontos de quebra ao adicionar campanhas/automações

1. **Roteamento inbound monocliente:** webhook sempre usa o workspace padrão. `mugozap-backend/server/app.py:5090`.
2. **Credencial Meta global por processo:** um conjunto de WABA/phone/token atende todo o backend. `mugozap-backend/server/services/whatsapp.py:20-33`.
3. **Chave de painel global + workspace solicitado:** a chave global pode assumir qualquer `X-Workspace-Id`. `mugozap-backend/server/app.py:524-548`.
4. **Idempotência não persistida no executor:** endpoints descartam a chave. `mugozap-backend/server/app.py:3673-3676`, `mugozap-backend/server/app.py:3717-3729`.
5. **Janela de 24h apenas no frontend:** o CRM bloqueia pela UI, mas o endpoint de texto não revalida no servidor. `src/components/WhatsAppPage.jsx:155-165`, `mugozap-backend/server/app.py:3658-3705`.
6. **Template hardcoded:** apenas um template e um parâmetro no endpoint inicial. `mugozap-backend/server/app.py:3720-3729`.
7. **Sem fila durável de campanhas:** follow-up atual percorre até 300 conversas e envia no processo. `mugozap-backend/server/services/followup.py:72-97`.
8. **Webhook sem assinatura:** eventos forjados podem alterar estado e disparar automação. `mugozap-backend/server/app.py:5001-5030`.
9. **Fallbacks legados sem workspace:** o serviço de estado tenta queries/upserts sem `workspace_id` quando encontra incompatibilidade. `mugozap-backend/server/services/state.py:148-170`, `mugozap-backend/server/services/state.py:283-291`.
10. **Exclusão destrutiva de conversa:** existe endpoint admin que apaga conversa, mensagens, tasks e estados. `mugozap-backend/server/app.py:3048-3085`, `mugozap-backend/server/app.py:3582-3607`.
11. **Logs com telefone/conteúdo:** inbound, outbound e startup registram wa_id, texto e configurações. `mugozap-backend/server/services/whatsapp.py:294-316`, `mugozap-backend/server/app.py:5094-5095`, `mugozap-backend/server/app.py:5152-5158`.
12. **Sends de debug em produção:** há endpoint autenticado de teste direto sem allowlist específica. `mugozap-backend/server/app.py:3221-3251`.

## 12. Riscos de segurança e isolamento multicliente

### Críticos

- **Webhook Meta sem `X-Hub-Signature-256`.** Permite payload forjado se a URL for conhecida. Evidência: `mugozap-backend/server/app.py:5001-5030`.
- **Tenant inbound incorreto.** Toda mensagem chega ao default workspace. Evidência: `mugozap-backend/server/app.py:5090`.
- **Escalada lateral pela chave global.** `PANEL_API_KEY` mais um header arbitrário escolhe o workspace. Evidência: `mugozap-backend/server/app.py:524-548`.
- **Secret impresso no startup.** `PANEL_API_KEY` é registrado integralmente. Evidência: `mugozap-backend/server/app.py:400-407`.

### Altos

- **Fallback sem tenant em state.py.** Compatibilidade legada pode ler/gravar pelo `wa_id` global. Evidência: `mugozap-backend/server/services/state.py:148-170`, `mugozap-backend/server/services/state.py:283-291`.
- **RLS incompleta no material fornecido.** Só `profiles` e pricing explicitam RLS; as tabelas operacionais preexistentes não têm policies confirmáveis nas migrations auditadas. Evidência: `mugozap-backend/supabase/migrations/20260624_profiles_permissions.sql:24`, `mugozap-backend/supabase/migrations/20260716_whatsapp_usage_pricing.sql:32-34`.
- **CORS amplo na Edge.** `Access-Control-Allow-Origin: *`; JWT reduz o risco, mas não substitui uma allowlist de origem. Evidência: `supabase/functions/mugozap-api/index.ts:3`.
- **Dados pessoais em logs.** Evidências em `mugozap-backend/server/app.py:5094-5095`, `mugozap-backend/server/app.py:5152-5158`.

### Médios

- Domínio/e-mail interno é uma segunda política de acesso independente dos perfis CRM. `mugozap-backend/server/services/auth.py:8-20`, `mugozap-backend/server/services/auth.py:47-60`.
- `whatsapp_pricing_rates` pode ser lida por qualquer autenticado, sem tenant; aceitável se a tabela for catálogo global, mas isso precisa ser uma decisão explícita. `mugozap-backend/supabase/migrations/20260716_whatsapp_usage_pricing.sql:32-34`.

## 13. Contratos de API atuais

### 13.1 Envelope CRM → Edge

Request:

```json
{
  "operation": "list_messages",
  "payload": {
    "waId": "<identificador>",
    "limit": 80
  }
}
```

Sucesso:

```json
{
  "ok": true,
  "data": {},
  "request_id": "<uuid>"
}
```

Erro:

```json
{
  "ok": false,
  "code": "INVALID_PAYLOAD",
  "message": "Mensagem compreensível",
  "status": 400,
  "upstream_status": 0,
  "retryable": false,
  "details": {},
  "request_id": "<uuid>"
}
```

Evidências: `src/services/data/whatsappRepository.js:102-121`, `supabase/functions/mugozap-api/index.ts:3-5`, `supabase/functions/mugozap-api/index.ts:542-554`.

Códigos confirmados:

- autenticação/configuração: `AUTH_SESSION_MISSING`, `AUTH_INVALID_TOKEN`, `PROFILE_NOT_FOUND`, `ORGANIZATION_NOT_FOUND`, `FORBIDDEN`, `SUPABASE_CONFIGURATION_MISSING`;
- validação: `METHOD_NOT_ALLOWED`, `INVALID_OPERATION`, `INVALID_PAYLOAD`, `INVALID_CONVERSATION_ID`, `IDEMPOTENCY_KEY_MISSING`, `PAYLOAD_TOO_LARGE`;
- Meta: `META_TOKEN_EXPIRED`, `META_PERMISSION_MISSING`, `META_RESOURCE_INVALID`, `META_API_ERROR`;
- templates: `TEMPLATE_NOT_FOUND`, `TEMPLATE_NOT_APPROVED`, `TEMPLATE_PARAMETERS_INVALID`, `TEMPLATE_PARAMETERS_MISSING`, `TEMPLATE_TEST_PHONE_FORBIDDEN`, `TEMPLATE_TEST_NAME_FORBIDDEN`;
- MugoZap: `UPSTREAM_UNAUTHORIZED`, `UPSTREAM_FORBIDDEN`, `UPSTREAM_NOT_FOUND`, `UPSTREAM_UNAVAILABLE`, `UPSTREAM_TIMEOUT`, `MUGOZAP_AUTH_FAILED`, `MUGOZAP_ENDPOINT_NOT_FOUND`, `MUGOZAP_COMPONENTS_UNSUPPORTED`, `MUGOZAP_TEMPORARY_ERROR`;
- confirmação: `MESSAGE_SEND_UNCONFIRMED`, `CRM_AUDIT_FAILED`.

Mapeamento base: `supabase/functions/mugozap-api/index.ts:114-120`, `supabase/functions/mugozap-api/index.ts:245-252`, `supabase/functions/mugozap-api/index.ts:427-531`.

### 13.2 Edge → MugoZap

Autenticação:

```http
X-Panel-Key: <secret>
X-Workspace-Id: <workspace>
Content-Type: application/json
```

Evidência: `supabase/functions/mugozap-api/index.ts:465-476`.

Contratos principais:

| Endpoint | Request | Response confirmada |
| --- | --- | --- |
| `GET /api/conversations` | sem body | `{ok:true, items:[...]}` |
| `GET /api/messages?wa_id=&limit=` | query | `{ok:true, items:[...]}` |
| `POST /api/conversations/{wa_id}/send` | `{text, idempotency_key}` enviado pela Edge; MugoZap lê `text` | `{ok:boolean}` no código atual |
| `POST /api/conversations/start-template` | `{wa_id, template_name, language, parameters, source, idempotency_key}` | `{ok:true, conversation, provider_message_id}` |
| `GET /api/templates/{name}?language=pt_BR` | query | `{ok:true, template:{name,language,status,...}}` |
| `GET /api/whatsapp/usage?days=` | query | resumo de mensagens/template/custo |

Evidências: `mugozap-backend/server/app.py:3548-3561`, `mugozap-backend/server/app.py:3610-3638`, `mugozap-backend/server/app.py:3658-3705`, `mugozap-backend/server/app.py:3708-3760`, `mugozap-backend/server/app.py:3763-3790`.

O contrato de mensagem livre é inconsistente: a Edge exige `provider_message_id` após sucesso, mas o endpoint mostrado retorna apenas `{ok}`. **Fato confirmado** (`mugozap-backend/server/app.py:3699-3705`, `supabase/functions/mugozap-api/index.ts:528-531`). **Hipótese**: a homologação real pode estar usando uma versão diferente do ZIP ou `safe_send` pode produzir efeito sem alterar o response.

### 13.3 MugoZap → Meta

Texto:

```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "<wa_id>",
  "type": "text",
  "text": {"preview_url": false, "body": "<texto>"}
}
```

Template:

```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "<wa_id>",
  "type": "template",
  "template": {
    "name": "<nome>",
    "language": {"code": "pt_BR"},
    "components": [
      {
        "type": "body",
        "parameters": [{"type": "text", "text": "<valor>"}]
      }
    ]
  }
}
```

Evidências: `mugozap-backend/server/services/whatsapp.py:110-130`, `mugozap-backend/server/services/whatsapp.py:299-305`.

## 14. Lacunas para a plataforma futura

| Capacidade | Estado atual | Lacuna confirmada |
| --- | --- | --- |
| Templates | Sync na Edge e status no MugoZap | fonte única, credencial por tenant, suporte integral a components/versionamento |
| Campanhas | Não há endpoint/tabela | campanha, estado, aprovação, limites e auditoria |
| Públicos | Filtro visual/clients | segmentos materializados, snapshot do público e exclusões |
| Agendamentos | Follow-up específico | fila durável, `run_at`, timezone, lease e retry controlado |
| Automações | `flow_state`, IA e follow-up específicos | definição versionada, execução durável, pausa humana e compensação |
| Webhook de status | sent/delivered/read/failed | roteamento tenant, assinatura, eventos para CRM e agregação por campanha |
| Métricas | uso/custo MugoZap e alertas CRM | funil campaign→recipient→message→status→reply→conversion |
| Descadastro | não encontrado | consentimento, opt-out por canal/finalidade e suppression list |
| Janela de 24h | inferida/bloqueada no frontend | cálculo e enforcement no executor backend |
| Idempotência | Edge gera/exige UUID | persistência/unique no MugoZap antes do POST Meta |

Evidências: rotas existentes em `mugozap-backend/server/app.py:3089-5001`; bloqueio de janela em `src/components/WhatsAppPage.jsx:155-165`; status em `mugozap-backend/server/app.py:5033-5063`; idempotência ausente nos parsers de envio em `mugozap-backend/server/app.py:3673-3676`, `mugozap-backend/server/app.py:3717-3729`.

## 15. Arquitetura alvo proposta

Esta proposta preserva React/Vite, Supabase, Edge Functions, FastAPI/MugoZap e Meta Cloud API.

### 15.1 Responsabilidades

**CRM/Supabase CRM**

- fonte de verdade de organização, usuário, cliente, contratos e parcelas;
- definição, aprovação e acompanhamento de campanhas;
- públicos e snapshots;
- consentimento/descadastro;
- UI de atendimento, campanhas, métricas e automações;
- nunca armazena token Meta no frontend.

**Edge `mugozap-api`**

- API Gateway/BFF autenticado;
- converte `organization_id` em uma conexão WhatsApp autorizada;
- valida papéis, escopo e contratos;
- nunca escolhe tenant a partir de header não vinculado;
- encaminha comandos e consultas ao MugoZap;
- não executa regras de campanha de longa duração.

**MugoZap**

- executor único de mensagens e templates;
- adaptador único da Meta;
- receptor/verificador de webhooks;
- cálculo server-side da janela de 24h;
- idempotência antes do POST Meta;
- persistência canônica de mensagem/status;
- worker durável de agendamentos e automações;
- emite eventos sanitizados para sincronização/Realtime do CRM.

### 15.2 Identidade multicliente mínima

Criar futuramente, mediante migration aprovada, uma entidade canônica:

```text
whatsapp_connections
  id
  organization_id
  workspace_id
  waba_id
  phone_number_id
  display_phone_number
  status
  graph_api_version
  credential_reference
  webhook_verify_reference
  created_by
  timestamps
```

Regras:

- unique por `organization_id + phone_number_id`;
- webhook resolve `value.metadata.phone_number_id → connection → workspace`;
- Edge resolve `organization_id → connection`; não aceita workspace livre;
- secrets ficam no backend por referência segura, nunca em tabelas legíveis pelo cliente;
- toda tabela operacional carrega `connection_id` e tenant.

### 15.3 Modelo incremental para campanhas

Futuras tabelas, não implementadas nesta auditoria:

- `whatsapp_campaigns`: definição, janela, template/version, status e aprovadores;
- `whatsapp_audiences`: regras e fonte;
- `whatsapp_audience_members`: snapshot e elegibilidade;
- `whatsapp_campaign_recipients`: estado individual, idempotência e suppression;
- `whatsapp_scheduled_actions`: `run_at`, timezone, lease, attempts e resultado;
- `whatsapp_consents`: finalidade, origem, prova, opt-in/opt-out;
- `whatsapp_events`: event log imutável de comando, provider e webhook;
- `whatsapp_automation_definitions` e `...executions`: apenas após estabilização.

### 15.4 Fluxo alvo de campanha

```text
Usuário cria rascunho no CRM
  → seleciona conexão/template APPROVED
  → gera snapshot do público
  → aplica consentimento, opt-out e dedupe
  → revisão humana e aprovação
  → cria scheduled_actions
  → worker MugoZap adquire lease
  → revalida tenant/template/consentimento/janela
  → reserva idempotency_key em transação
  → envia uma vez à Meta
  → webhook assinado atualiza status
  → eventos alimentam métricas no CRM
```

### 15.5 Migração sem quebrar o atual

1. Adicionar observabilidade e assinatura do webhook sem mudar responses.
2. Criar mapeamento explícito organização/workspace/conexão mantendo o default como registro legado.
3. Fazer o MugoZap persistir idempotência, aceitando os payloads atuais.
4. Mover a leitura de templates para uma única API MugoZap, mantendo temporariamente a resposta Edge atual.
5. Adicionar `connection_id` de forma compatível e backfill auditado.
6. Só então introduzir campanhas em modo draft/simulação.
7. Preservar o inbox e os endpoints atuais por versão/adapter durante a transição.

## 16. Priorização recomendada

### P0 — antes de qualquer campanha

1. Validar assinatura do webhook Meta.
2. Remover secret/PII dos logs.
3. Resolver tenant pelo `phone_number_id`.
4. Persistir idempotência no MugoZap.
5. Aplicar janela de 24h no backend.
6. Eliminar fallbacks de leitura/escrita sem workspace.

### P1 — fundação multicliente

1. Mapear `organization_id ↔ workspace_id ↔ connection`.
2. Credenciais Meta por conexão.
3. Fonte única de templates.
4. Event log de mensagem/status.
5. Consentimento e suppression list.

### P2 — primeira campanha controlada

1. Campanha draft/aprovada.
2. Snapshot de público.
3. Agendamento durável.
4. Rate limiting por conexão.
5. Métricas por destinatário e campanha.

## 17. Hipóteses que exigem validação posterior

1. **Hipótese:** CRM e MugoZap podem usar projetos Supabase diferentes; os arquivos não permitem provar se `organization_id` e `workspace_id` coexistem no mesmo banco.
2. **Hipótese:** a versão implantada do MugoZap pode ser posterior ao ZIP, pois o contrato de response de mensagem livre diverge do que a Edge exige.
3. **Hipótese:** as tabelas-base MugoZap podem ter RLS/FKs não presentes nas migrations fornecidas.
4. **Hipótese:** provider message IDs são globalmente únicos na Meta; o índice atual os trata como globais.
5. **Hipótese:** o modo de campanhas exigirá limites por tier/qualidade da conta, não representados no código atual.

## 18. Conclusão

O sistema atual deve ser preservado como caminho de atendimento individual. A evolução segura não é colocar campanhas diretamente no frontend nem duplicar novos fluxos no CRM e no MugoZap. O passo arquitetural decisivo é tornar a conexão WhatsApp uma entidade multicliente explícita, fazer o MugoZap ser o único executor/adapter Meta e manter a Edge como gateway autenticado da organização.

Antes de campanhas, os bloqueadores objetivos são: assinatura do webhook, roteamento por `phone_number_id`, idempotência persistida, janela de 24h server-side, remoção dos fallbacks sem tenant e unificação do catálogo de templates.
