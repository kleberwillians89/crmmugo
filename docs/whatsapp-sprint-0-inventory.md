# Sprint 0 — inventário de versão e schema

Data: 2026-07-28  
Escopo: CRM local e MugoZap fornecido em `mugozap 2.zip`. Nenhum secret foi lido ou reproduzido.

## Versões

| Projeto | Origem auditada | Branch | HEAD | Estado |
| --- | --- | --- | --- | --- |
| CRM | `/Users/klebs/Desktop/crm.mugoagencia` | `main` | `9d05ca1954472a9869166f487ffaac910ab7a71a` | Há documentação preexistente modificada/não rastreada |
| MugoZap | ZIP, materializado em `mugozap-backend/` | `main` | `7c43ca2f8ae8ccc2d7c4d5de25447b9ef778ff91` | O ZIP já continha mudanças não commitadas |

Alterações preexistentes no MugoZap, preservadas: `server/app.py`, `server/services/followup.py`, `server/services/state.py`, `web/src/App.jsx` e as migrations `20260716_business_initiated_automation.sql` e `20260716_whatsapp_usage_pricing.sql`. O `server/state.db` versionado não foi importado por poder conter dados operacionais.

O lint do frontend MugoZap também apresenta duas falhas preexistentes em `web/src/api.js` (`preserve-caught-error` e `no-useless-assignment`). Elas não foram alteradas nesta sprint.

## Implantação conhecida

- CRM local: HEAD `9d05ca1`.
- Último frontend citado na homologação anterior: `0c8a4e77f43012a6e9b3ed0a688a1def23535c85`. A correspondência com produção exige confirmação manual.
- Edge Function citada anteriormente: `mugozap-api` v35. A versão remota não foi consultada nesta sprint.
- MugoZap implantado: versão/commit não comprovado. Não se assume que o ZIP corresponde à produção.

## Endpoints encontrados no MugoZap

- Sistema/autenticação: `GET /health`, `GET /api/me`.
- Usuários: `GET/POST /api/users`, `PATCH /api/users/{profile_id}`.
- Debug: `GET /api/debug/ai-state/{wa_id}`, `GET /api/debug/meta-env`, `POST /api/debug/send-test-whatsapp/{wa_id}`, `GET /api/debug/lead-state/{wa_id}`, `POST /api/debug/reset-lead/{wa_id}`, `POST /api/debug/simulate-incoming/{wa_id}`.
- Conversas/mensagens: `GET /api/conversations`, `GET /api/conversations/by-phone/{phone}`, `DELETE /api/conversations/{wa_id}`, `GET /api/messages`, `GET /api/conversations/{wa_id}`, `POST /api/conversations/{wa_id}/send`, `POST /api/conversations/start-template`.
- Templates/uso: `GET /api/templates/{template_name}`, `GET /api/whatsapp/usage`.
- Atendimento, tarefas e integrações: rotas sob `/api/attendance`, `/api/tasks`, `/api/integrations`, `/webhooks/mugo-intelligence`, `/api/followups/run` e `/api/jobs/run-followups`.
- Meta: `GET /webhook`, `POST /webhook`.
- Sprint 0: `POST /internal/v2/commands`, desligado por padrão.

## Edge e contrato atual

A Edge `supabase/functions/mugozap-api/index.ts` autentica o usuário do CRM, resolve organização e encaminha `X-Workspace-Id`, `X-Panel-Key` e operações V1. O repository ainda deriva workspace de `app_metadata` e envia o header legado. Isso é mantido para V1.

Divergências:

1. O MugoZap local aceita `PANEL_API_KEY` como identidade global e permite workspace solicitado no header; V2 proíbe ambos.
2. A Edge possui um dispatcher por `operation`; o MugoZap expõe rotas REST. O mapeamento é responsabilidade da Edge.
3. O ZIP possui endpoint de status de template e alterações de métricas ainda não presentes no HEAD.
4. Não existe registry confirmado de `connection_id -> organization_id -> workspace_id`; V2 implementa a interface, não a persistência.
5. CRM e MugoZap possuem conjuntos de migrations diferentes. Não há evidência de que compartilhem o mesmo Supabase.

## Migrations e tabelas esperadas

CRM: migrations de fundação/comercial, fluxo de cobrança WhatsApp, auditoria de sync e produção de templates, incluindo `whatsapp_templates`, `whatsapp_template_sync_runs`, `whatsapp_conversation_links` e `whatsapp_collection_alerts`.

MugoZap: migrations para `workspaces`, colunas `workspace_id` em tabelas legadas, permissões de profiles, automação iniciada pela empresa e pricing/usage. O código espera, por configuração, tabelas de conversas, usuários, mensagens, tarefas, `ai_state`, `whatsapp_flow_state`, profiles e workspaces.

## Hipóteses e pendências

- Hipótese: uma organização do CRM corresponde atualmente a um workspace MugoZap.
- Hipótese: o `workspace_id` no JWT/app metadata foi provisionado de forma confiável.
- Pendente: confirmar hash do MugoZap em produção.
- Pendente: exportar somente metadados do schema real de cada Supabase.
- Pendente: confirmar se tabelas de pricing/status já existem em produção.
- Pendente: definir registry e fonte de verdade de `connection_id`.
- Pendente: confirmar política de papel administrativo entre CRM e MugoZap.

## Riscos de deploy

- O ZIP não é comprovadamente igual à produção.
- Alterações preexistentes podem ir juntas se o diff não for separado antes do deploy.
- `report` depende de `META_APP_SECRET` correto para produzir sinal útil.
- Habilitar V2 antes do registry permite apenas validação estrutural, não vínculo completo de conexão.
- Endpoints debug podem ser usados por rotinas operacionais não inventariadas.

## Confirmações manuais necessárias

1. Hash/imagem atualmente implantada do MugoZap.
2. Valores das três flags no ambiente, sem revelar secrets.
3. Presença de `META_APP_SECRET`.
4. Chamadores reais de `/api/debug/*`.
5. Schemas/tabelas remotos via inventário sem dados.
6. Correspondência entre organization, connection e workspace.
