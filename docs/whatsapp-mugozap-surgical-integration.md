# Auditoria comparativa e integração cirúrgica CRM × MugôZap

Data: 2026-08-31  
Branch: `feat/mugozap-whatsapp-engine`

## Decisão arquitetural

`Meta / MugôZap` são transporte/provider. O Supabase do CRM é a fonte canônica de contatos, conversas, mensagens, status, atendimento, follow-up e definições/execuções de automação. A Inbox lê somente `whatsapp_conversations`, `whatsapp_contacts` e `whatsapp_messages`; indisponibilidade do endpoint legado `/api/conversations` não apaga a interface.

## Evidência do projeto de referência

O repositório fornecido foi auditado em `_reference/mugozap/mugo-zap/server`. Os contratos observados foram congelados em `tests/fixtures/mugozap-transport-contract.json`.

| Capacidade | MugôZap de referência | CRM após a integração |
| --- | --- | --- |
| Envio manual | `POST /api/conversations/{wa_id}/send`; retorna apenas `{ok}` e descarta o wamid | O adapter usa Meta diretamente, reserva idempotência e só confirma após obter/persistir `provider_message_id` |
| Template | `POST /api/conversations/start-template`; aceita somente `mugo_alerta_pagamento_pendente:pt_BR` e retorna wamid | Cobrança mantém esse contrato; templates de automação usam Meta e exigem template aprovado no tenant |
| Histórico | `/api/conversations` e `/api/messages`, storage por `workspace_id` | Tabelas operacionais canônicas por organização/conexão; upstream não é fonte da Inbox |
| Webhook | GET/POST, mas sem HMAC; POST ignora status e resolve workspace default | HMAC obrigatório, ledger/dedupe, status Meta e tenant por `phone_number_id` |
| Atendimento | Estado humano/bot e handoff maduros | Estado é gravado primeiro/espelhado na conversa canônica; MugôZap é compatibilidade opcional |
| Follow-up/flows | Estado e rotinas internas próprias | Fila durável e graph v2 versionado no CRM; resposta inbound cancela follow-up |
| Multiempresa | `workspace_id`, com fallback/default no webhook | `organization_id + connection_id + wa_id`, RLS e triggers contra associação cruzada |

## Migration history e drift

As migrations remotas já aplicadas `202608310001_whatsapp_automation_activation.sql` e `202608310002_whatsapp_automation_triggers.sql` foram restauradas byte a byte à versão histórica (`git diff --exit-code` retorna zero para ambas). Nenhum hardening novo depende de editar esses arquivos.

O que permaneceu histórico:

- `310001`: criação/expansão das tabelas de automação, backfills originais, RLS, constraints e RPCs da fila;
- `310002`: emissão de eventos por triggers de lead/parcela.

O que foi movido para `202608310004_whatsapp_operational_hardening.sql`:

- tenant obrigatório em versões/steps via constraints `NOT VALID`;
- versão ativa precisa pertencer ao mesmo fluxo/tenant;
- versão precisa pertencer ao tenant do fluxo;
- nome novo de fluxo entre 2 e 120 caracteres;
- correção aditiva da função `lead_created` para o status real `lead`;
- proteção tenant conexão→contato, cliente→contato e conexão→webhook;
- contador de não lidas e RPCs de incremento/leitura.

`NOT VALID` evita varredura/rejeição imediata de legado, mas passa a proteger novas escritas. Não há delete, reprocessamento de saneamento ou aplicação remota.

## Caso Ana e causa raiz

A causa arquitetural é comprovável no código: o fluxo antigo confirmava o alerta em `whatsapp_collection_alerts`/MugôZap, enquanto a Inbox era lida do storage do upstream e ainda não havia o ledger criado pela `310003`. Assim, um `provider_message_id` podia existir sem `whatsapp_contact`, `whatsapp_conversation` e `whatsapp_message` canônicos. A regra de duplicidade então bloqueava o reenvio, mas não reconstruía a Inbox.

A operação `reconcile_whatsapp_history` agora lê apenas alertas do tenant com `provider_message_id` e faz upsert de contato/conversa/mensagem, usando `collection-alert-{alert_id}` e o wamid como chaves. A própria tentativa duplicada de cobrança executa essa reconstrução e retorna `already_sent: true`; nunca chama transporte para reconstruir histórico.

Limite da evidência: este checkout possui apenas chave pública do Supabase, sem sessão autenticada/service role, e não havia navegador conectado. Portanto o registro remoto específico da Ana não foi lido nem alterado. O teste `whatsapp-ana-reconciliation.test.mjs` prova o cenário equivalente (alerta confirmado → conversa/mensagem → Inbox, duas execuções idempotentes, zero reenvios), mas o resultado remoto depende do gate operacional abaixo.

## Fluxo operacional final

- Outbound: reserva canônica por idempotência → Meta/MugôZap → wamid → upsert contato/conversa/mensagem → resposta canônica → refetch imediato/realtime.
- Inbound: Meta → HMAC → conexão por `phone_number_id` → mesmo `(connection_id, wa_id)` → mensagem inbound → unread → cancelamento de follow-up → evento `whatsapp_message_received`.
- Status: ledger por `connection_id + wamid + status + timestamp` → update da mensagem existente; não insere mensagem de status e não regride `read/delivered`.
- Handoff: atualiza `attendance_mode`, `automation_paused`, motivo e evento canônico; sincronização upstream é secundária.
- Flow builder: `automation_versions.definition` schema v2 (`nodes`/`edges`), adapter do schema linear, validação antes de salvar/ativar e executor real de ramos SIM/NÃO, wait/resume e retry por node.

## Gate de deploy (não executado)

Secrets necessários nas Edge Functions:

- Supabase: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`;
- Meta: `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_ACCESS_TOKEN`, `PHONE_NUMBER_ID`, `WABA_ID`, `GRAPH_API_VERSION`;
- worker: `AUTOMATION_WORKER_KEY`;
- compatibilidade/handoff MugôZap: `MUGOZAP_API_URL`, `PANEL_API_KEY` e, se usado, `MUGOZAP_WORKSPACE_ID`.

Comandos para o operador executar somente após revisão/staging:

```bash
supabase link --project-ref SEU_PROJECT_REF
supabase db push --dry-run
supabase db push
supabase functions deploy mugozap-api
supabase functions deploy whatsapp-webhook --no-verify-jwt
supabase functions deploy whatsapp-automation-worker --no-verify-jwt
```

Depois do deploy, em sessão admin do CRM, executar uma única vez `reconcileWhatsAppHistory(500)` e conferir o item da Ana por `alert_id`, `provider_message_id` e `conversation_id`. Não repetir o envio.
