# Sprint 1.1 — reconciliação de ambientes

Data: 2026-07-28  
Decisão atual: **NO-GO para aplicação de migrations**

## Resultado seguro

| Sistema | Project ref sanitizado | Papel | Estado |
| --- | --- | --- | --- |
| CRM Supabase | `***kmbn` | Control-plane canônico | Confirmado |
| MugoZap Supabase | `***eyxy` | Execution-plane operacional | Confirmado |

Conclusão: **projetos separados**.

O `SUPABASE_URL` do MugoZap aponta para Supabase. `ALLOW_ORIGIN` indica infraestrutura Render; isso identifica a origem web permitida, mas não prova isoladamente o serviço ou commit implantado. O commit implantado continua não confirmado.

## Variáveis

Foram encontrados nomes para Supabase, Meta, autenticação do painel, webhook interno, OpenAI, CORS e runtime. Valores não foram exibidos. Chaves e tokens foram tratados como `[REDACTED]`.

As flags novas estão ausentes no arquivo fornecido:

- `WHATSAPP_SIGNED_WEBHOOKS_MODE`;
- `MUGOZAP_DEBUG_ENDPOINTS_ENABLED`;
- `WHATSAPP_TENANT_CONTEXT_V2`;
- `WHATSAPP_CONNECTIONS_V2`;
- `WHATSAPP_CONNECTIONS_V2_READ_MODE`;
- `MUGOZAP_INTERNAL_V2_SECRET`.

Pelos defaults do código local: assinatura inicia em `report`, debug/V2/connections ficam desligados e read mode é `shadow`. Isso precisa ser confrontado com o artefato implantado.

## Schema operacional confirmado

| Objeto | MugoZap remoto |
| --- | --- |
| `whatsapp_users` | Existe; `workspace_id` e `wa_id` presentes |
| `whatsapp_conversations` | Existe; `workspace_id` e `wa_id` presentes |
| `whatsapp_messages` | Existe; `workspace_id`, `wa_id` e `provider_message_id` presentes |
| `whatsapp_messages.phone_number_id` | Ausente ou incompatível |
| `workspaces` | Ausente |
| `profiles` | Ausente |
| `whatsapp_message_templates` | Ausente |
| `whatsapp_connection_registry` | Ausente |
| `whatsapp_connections` | Ausente |

As consultas usaram `limit=0`, descartaram o corpo e registraram somente existência/ausência.

## Destino das migrations

| Objeto | Projeto destino |
| --- | --- |
| `202607280001_whatsapp_connections_v2.sql` | CRM `***kmbn` |
| `whatsapp_connection_registry` | MugoZap `***eyxy`, em migration separada |
| Campanhas, públicos, consentimento e agendamentos | CRM/control-plane |
| Outbox de projeção | CRM/control-plane |
| Fila de execução e idempotência de envio | MugoZap/execution-plane |
| Catálogo canônico de templates | CRM/control-plane |
| Projeção operacional de templates | MugoZap, quando necessária ao executor |
| Eventos brutos de entrega/leitura/falha | MugoZap |
| Agregados e projeções comerciais de métricas | CRM |

## Registry operacional

É necessária uma migration adicional para `whatsapp_connection_registry` no MugoZap. Ela deve conter apenas UUID canônico, organization/workspace, provider, IDs Meta, status, capabilities, health, referências opacas, versão e timestamps de projeção.

Não deve conter tokens. Deve ser inacessível a anon/authenticated e gravável somente pelo serviço interno autenticado. Phone ID deve ser único.

## Divergências e bloqueios

1. Migrations locais do MugoZap criam `workspaces` e `profiles`, mas o remoto não as expõe.
2. O código local tem HEAD `7c43ca2`; o commit implantado é desconhecido.
3. O `.env` implantado não contém as flags novas.
4. Não há registry operacional.
5. Webhook deve resolver usando `metadata.phone_number_id` e o registry.
6. DDL/policies/constraints completos ainda não foram exportados.
7. Testes RLS ainda não rodaram em staging.

## Comandos futuros

No projeto CRM, depois de garantir que somente migrations aprovadas estejam pendentes:

```bash
supabase db push --linked --dry-run
```

Após revisão explícita do dry-run:

```bash
supabase db push --linked
```

O projeto MugoZap usará os mesmos comandos em workspace Supabase próprio, vinculado a `***eyxy`, depois da criação/revisão da migration operacional. Nenhum comando foi executado.

## Go/no-go

`202607280001` pertence ao projeto correto, mas **não pode ser aplicada agora**. A decisão é **NO-GO** até que os bloqueios acima sejam resolvidos.
# Encaminhamento para Sprint 1.2

A separação ambiental confirmada foi preservada: outbox e estado canônico ficam no Supabase do CRM; registry e ledger ficam no Supabase do MugoZap. A implementação local não compartilha service roles, não copia credenciais e não realiza chamadas Meta. Aplicação continua condicionada à validação em staging.

