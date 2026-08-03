# Sprint 1 — validação de ambiente

Data: 2026-07-28  
Decisão do gate: **implementação exclusivamente local e feature-flagged**. A migration desta sprint não deve ser aplicada até aprovação manual.

Atualização Sprint 1.1: CRM e MugoZap foram confirmados como projetos Supabase separados. A decisão de aplicação permanece **NO-GO**.

## Evidências seguras

| Item | Estado | Evidência |
| --- | --- | --- |
| Supabase CRM | Confirmado parcialmente | Projeto vinculado localmente, ref exibida apenas como `***kmbn` |
| Supabase MugoZap | Confirmado | Arquivo operacional fornecido; project-ref exibido somente como `***eyxy` |
| Mesmo projeto | Confirmado: não | CRM `***kmbn` e MugoZap `***eyxy` são projetos distintos |
| CRM local | Confirmado | `main`, `9d05ca1954472a9869166f487ffaac910ab7a71a` |
| MugoZap local | Confirmado | `main`, `7c43ca2f8ae8ccc2d7c4d5de25447b9ef778ff91` |
| MugoZap implantado | Bloqueio | Nenhum identificador de imagem/commit remoto disponível |
| Divergência local/implantado | Bloqueio | Não pode ser calculada sem hash/artefato implantado |

Nenhuma URL, service role, token, panel key ou conteúdo de secret foi lido ou impresso.

## Schema remoto do CRM

Confirmado por inspeção somente leitura de nomes/tamanhos:

- `organizations`;
- `profiles`;
- `whatsapp_message_templates`.

Ausentes da listagem do projeto CRM:

- `workspaces`;
- `whatsapp_users`;
- `whatsapp_conversations`;
- `whatsapp_messages`.

`whatsapp_connections` ainda não existe.

## Schema remoto do MugoZap

Confirmado por consultas REST `limit=0`, sem leitura de linhas:

- `whatsapp_users`: existe; `workspace_id` e `wa_id` presentes;
- `whatsapp_conversations`: existe; `workspace_id` e `wa_id` presentes;
- `whatsapp_messages`: existe; `workspace_id`, `wa_id` e `provider_message_id` presentes;
- `whatsapp_messages.phone_number_id`: ausente ou incompatível.

Confirmado como ausente no projeto MugoZap:

- `organizations`;
- `profiles`;
- `workspaces`;
- `whatsapp_message_templates`.
- `whatsapp_connections`;
- `whatsapp_connection_registry`.

Isso diverge das migrations locais, que preveem `workspaces` e `profiles`. A obtenção de metadados de colunas via OpenAPI está desabilitada ou indisponível nessa instância.

## RLS, constraints e índices

O dump remoto de schema não foi possível porque a versão instalada do Supabase CLI exige Docker e o daemon não está ativo. Portanto:

- RLS remoto: não confirmado;
- policies remotas: não confirmadas;
- constraints remotas: não confirmadas;
- índices remotos: não confirmados.

As migrations do CRM confirmam apenas a intenção local: `current_organization_id()`, `is_active_user()`, `is_admin()`, RLS em entidades comerciais e papéis atuais `admin`, `manager`, `finance`, `commercial`, `operations`, `viewer`.

## Divergências conhecidas

1. CRM organiza tenant por `organization_id`; MugoZap local usa `workspace_id`.
2. Os schemas de `profiles` e os conjuntos de papéis são diferentes.
3. A Edge conhece organização, mas ainda encaminha workspace V1.
4. Não existe canal comprovado de projeção CRM → MugoZap.
5. O ZIP contém alterações preexistentes não commitadas e migrations fora do HEAD.
6. O banco local `state.db` não foi importado.

## Hipóteses

- Confirmado: CRM e MugoZap usam Supabase distintos.
- Hipótese: o workspace legado corresponde à única organização atual.
- Hipótese: o código implantado do MugoZap difere do HEAD e pode incluir parte do working tree do ZIP.

## Bloqueios para aplicação

Antes de aplicar a migration:

1. confirmar hash/imagem implantada;
2. exportar DDL remoto de ambos sem dados;
3. confirmar policies, constraints e índices;
4. criar/revisar migration operacional de `whatsapp_connection_registry`;
5. configurar posteriormente autenticação HMAC interna, sem alterar secrets nesta etapa;
6. confirmar mapeamento organization ↔ workspace sem depender de tabela hoje ausente;
7. validar migration em staging e executar testes RLS;
8. revisar as alterações preexistentes separadamente.

## Arquivo operacional fornecido

O arquivo `mugo-zap.env` confirmou a presença das configurações legadas de Supabase, painel e Meta e o formato numérico de WABA/phone ID. Valores não foram exibidos nem copiados.

Não estão presentes nesse arquivo:

- `META_APP_SECRET`;
- `WHATSAPP_SIGNED_WEBHOOKS_MODE`;
- `MUGOZAP_DEBUG_ENDPOINTS_ENABLED`;
- `WHATSAPP_TENANT_CONTEXT_V2`;
- `WHATSAPP_CONNECTIONS_V2`;
- `WHATSAPP_CONNECTIONS_V2_READ_MODE`;
- `MUGOZAP_INTERNAL_V2_SECRET`.

O arquivo possui permissão `0644`, permitindo leitura por outros usuários locais. Recomenda-se alterar para `0600` antes de mantê-lo como fonte operacional.
