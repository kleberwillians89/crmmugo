# CRM Mugô ↔ Mugô Dados — ponte de dados (read-only)

Documento de referência para o funil canônico, o modelo de atribuição e a API exposta ao Mugô Dados.
Nada aqui foi inferido: cada métrica mapeia para uma tabela/coluna/status real já existente no schema.

## Granularidade: por cliente, não por organização

O CRM Mugô hoje tem uma única `organization_id` (Agência Mugô) contendo vários `clients` (Roove,
Origami, Curavino...). Um mapping `external_integrations` que resolvesse só `organization_id` faria
a API devolver dados de **todos** os clientes da agência para um único `external_client_id` — errado
por construção. Por isso `external_integrations` vincula `organization_id` **e** `client_id`
(migration corretiva `202609290002_external_integrations_client_scope.sql`, que adiciona `client_id`
sem editar a `202609290001` retroativamente, já aplicada em produção com a tabela vazia), e **toda**
tabela do funil é filtrada por `organization_id` + `client_id` juntos, nunca só por organização.

## Funil canônico

| Etapa | Fonte | Definição exata |
| --- | --- | --- |
| `leads` | `commercial_opportunities` | `count(*)` de linhas do `client_id` resolvido criadas no período (`entered_at` dentro do range). Cada conversa externa que virou oportunidade DAQUELE cliente é um lead. |
| `qualified_leads` | `commercial_qualifications` | `count(*)` onde `qualified = true`, join por `opportunity_id` — deriva só dos `opportunity_id`s já filtrados por `organization_id`+`client_id` acima; a tabela em si não tem coluna de tenant própria. |
| `opportunities` | `commercial_opportunities` | `count(*)` onde `stage <> 'new_lead'` — já saiu do primeiro contato e está sendo trabalhada (`qualifying`, `qualified`, `meeting`, `proposal`, `negotiation`, `won`, `lost`, `in_service`). |
| `proposals` | `proposals` | `count(*)` onde `sent_at is not null` — proposta de fato enviada (rascunho não conta). |
| `won_sales` | `proposals` | `count(*)` onde `status = 'won'`. |
| `lost_sales` | `proposals` | `count(*)` onde `status = 'lost'`. |
| `revenue` | `proposals` | `sum(total_value)` onde `status = 'won'` — valor contratado/fechado. |
| `received_revenue` | `invoice_installments` | `sum(amount)` (BRL) onde `status = 'paid'` — dinheiro que realmente entrou, nunca inferido de proposta. |

Todas as linhas da tabela acima são sempre filtradas por `organization_id = X AND client_id = Y` —
nunca só `organization_id = X`.

Regras que o código nunca quebra (checadas nos testes):
- **Proposal ≠ sale**: `proposals.status='sent'/'viewed'/'negotiating'` nunca conta como `won_sales`.
- **Sale ≠ received cash**: `revenue` (proposta ganha) e `received_revenue` (parcela paga) são números
  diferentes, de tabelas diferentes — nunca somados nem confundidos.
- **Collection ≠ payment**: `whatsapp_collection_alerts` (cobrança enviada) nunca é fonte de receita;
  só `invoice_installments.status='paid'` conta como recebido.
- Nenhuma venda é inferida de conteúdo de conversa (`whatsapp_messages`/`conversation_summaries`) —
  só de `proposals`/`commercial_opportunities`, que são as entidades estruturadas do pipeline.

`opportunities` como "etapa distinta de lead" é uma escolha de modelagem (o schema atual tem uma única
tabela `commercial_opportunities` cobrindo lead→won/lost por `stage`) — documentada aqui para que
qualquer ajuste futuro mude só este documento e a query correspondente, nunca a definição informalmente.

## Atribuição

Campos que **já existem** e já são usados por `/attribution`:
- `commercial_opportunities.source` (categoria inferida: `META_ADS_WHATSAPP`, `GOOGLE_ADS`,
  `INSTAGRAM`, `REFERRAL`, `SITE`, `WHATSAPP_ORGANIC`, `OUTRO` — ver `inferLeadSource` em
  `supabase/functions/_shared/commercialAgentCore.js`)
- `commercial_opportunities.campaign`, `ad_name`
- `commercial_opportunities.utm_source`, `utm_medium`, `utm_campaign`, `utm_content` (colunas
  diretas, não é preciso ler JSON)
- `whatsapp_contacts.source/campaign/ad_name/utm` (jsonb) — atribuição em nível de contato, capturada
  no primeiro contato; preservada mesmo se a oportunidade for recriada depois (ver
  `whatsapp-webhook/index.ts`, `priorContact`).

Campos que **faltam** (identificadores estáveis de clique/anúncio) — nenhum dado inventado, gap real:
`meta_campaign_id`, `meta_adset_id`, `meta_ad_id`, `google_campaign_id`, `gclid`, `fbclid`. Hoje
`extractLeadAttribution` (`commercialAgentCore.js:108-122`) só usa a PRESENÇA desses valores para
inferir a categoria `source` — nunca os persiste. Se o Mugô Dados precisar desses IDs específicos,
a captura terá que ser adicionada na origem (webhook/lead capture), não inventada na ponte. Não
recomendado adicionar colunas duplicadas agora — só se/quando a captura real existir.

Origem desconhecida (`source` nulo ou `WHATSAPP_ORGANIC` sem UTM) permanece desconhecida na resposta
da API — nunca é adivinhada.

## Segurança da ponte

- Autenticação: header `X-Data-Platform-Key` contra `DATA_PLATFORM_API_KEY` (env/Vault da função,
  mesmo padrão de `X-Collection-Worker-Key`/`X-Task-Command-Worker-Key`). Nunca aceita JWT de usuário
  final nem expõe `service_role` — a função usa a service role só internamente, no servidor.
- Tenant: o chamador nunca informa `organization_id` nem `client_id` diretamente. Informa
  `external_client_id` (o id que o Mugô Dados usa para aquele tenant); a função resolve
  `organization_id` **e** `client_id` via `external_integrations`
  (`provider='mugo_dados' and status='active'`). Não existe parâmetro que permita pedir dados de
  outro tenant nem de outro cliente da mesma organização.
- Toda query é filtrada por `organization_id` **e** `client_id` resolvidos juntos — nunca por nome de
  empresa, e nunca por organização sozinha (uma organização tem vários clients).
- Consistência reforçada no próprio banco: um trigger (`protect_external_integration_tenant`, mesmo
  padrão de `protect_whatsapp_operational_tenant`) recusa gravar em `external_integrations` um
  `client_id` que não pertença à `organization_id` da linha — não depende só da aplicação estar certa.
- Paginação: `limit`/`offset` explícitos (padrão 100, máximo 500) nas listagens; `/revenue` e
  `/funnel` são agregados (um valor por período, sem paginação necessária).
- Período: `period_start`/`period_end` obrigatórios (formato `YYYY-MM-DD`), sempre limitando as
  queries — nunca "todos os tempos" por padrão.
- Nunca retorna: texto de mensagem do WhatsApp, notas internas (`internal_notes`), tokens/secrets,
  dados pessoais além do necessário para o funil (nome do cliente não é exposto; só `client_id`/
  `external_client_id` e as dimensões de atribuição).
- Logs não gravam corpo da resposta nem PII — só `organization_id`, endpoint, status, duração
  (mesmo padrão de `auditOperation` já usado em `mugozap-api`).

## Endpoints (todos GET, somente leitura)

Autenticação: header `X-Data-Platform-Key: <DATA_PLATFORM_API_KEY>`.
Parâmetros comuns: `external_client_id` (obrigatório), `period_start`, `period_end` (obrigatórios,
`YYYY-MM-DD`).

- `GET /data-platform-api/funnel?external_client_id=...&period_start=...&period_end=...`
  → `{ leads, qualified_leads, opportunities, proposals, won_sales, lost_sales }`
- `GET /data-platform-api/attribution?external_client_id=...&period_start=...&period_end=...`
  → lista agrupada por `source, campaign, utm_source, utm_medium, utm_campaign` com contagem de
  `leads`/`qualified_leads`/`won_sales` por grupo.
- `GET /data-platform-api/revenue?external_client_id=...&period_start=...&period_end=...`
  → `{ currency, revenue, received_revenue }` por moeda (nunca soma BRL+EUR).

## Admin/configuração pendente

Implementados nesta entrega: tabela `external_integrations` com `client_id` obrigatório (duas
migrations — `202609290001` criou a tabela, `202609290002` corrigiu a granularidade para
organização+cliente — nenhuma aplicada em produção ainda) e a Edge Function. **UI pendente** (não
implementada nesta entrega, para não ampliar o escopo): um painel simples nas Configurações mostrando
Status (Conectado/Não conectado), Cliente (`client_id`), External Client ID, e ações
Salvar/Desconectar, restrito a `is_admin()`. O backend (tabela + policies + trigger de consistência)
já suporta essa UI sem mudança adicional — é só ligar um formulário CRUD simples a
`external_integrations`, com um seletor de `clients` da própria organização.
