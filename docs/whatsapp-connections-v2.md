# WhatsApp Connections V2

Status: implementação local, flags desligadas, migration não aplicada  
ADR: [ADR-011](adr/ADR-011-whatsapp-connections-storage.md)

## Origem da verdade

O Supabase CRM (`***kmbn`) é o control-plane canônico. O MugoZap usa um projeto separado (`***eyxy`) e manterá uma projeção operacional read-only pelo mesmo UUID. O canal proposto é outbox + endpoint interno HMAC, conforme ADR-012.

O CRM cria e atualiza. A Edge autentica usuário, organização e papel. O MugoZap lê a projeção, resolve tenant e credenciais. Em conflito, o CRM vence. O execution-plane nunca cria uma configuração concorrente.

## Schema canônico

Migration local: `supabase/migrations/202607280001_whatsapp_connections_v2.sql`.

Campos:

- identidade: `id`, `organization_id`, `workspace_id`, `provider`;
- Meta: `waba_id`, `phone_number_id`, `display_phone_number`, `verified_name`, `graph_api_version`;
- referências opacas: `credential_reference`, `webhook_verify_reference`;
- operação: `status`, `connection_health`, `capabilities`, `metadata`;
- tempo/auditoria: `last_sync_at`, `last_health_check_at`, `created_by`, `created_at`, `updated_at`.

Estados: `draft`, `connecting`, `active`, `degraded`, `disabled`, `revoked`, `error`.

Uma conexão `active` exige WABA, phone ID e referência de credencial. IDs Meta aceitam apenas dígitos. Provider está limitado a `meta_cloud_api`. Tokens não são colunas e chaves sensíveis são rejeitadas no topo de `metadata`.

Unicidade e índices cobrem organização, status, workspace, phone ID, provider e health. O phone ID não pode ser duplicado.

## RLS e visão pública

- RLS e FORCE RLS habilitados.
- Leitura limitada à organização ativa.
- Insert/update somente para `admin`; criação de cliente fica em `draft`/`connecting` e sem referências.
- Organization, workspace e referências são imutáveis para usuários comuns.
- Grants por coluna bloqueiam leitura das referências.
- `whatsapp_connections_public` usa `security_invoker` e mascara telefone.
- `get_whatsapp_connection_public` e `resolve_whatsapp_connection_shadow` retornam apenas campos sanitizados.
- Service role permanece ferramenta técnica; autorização administrativa deve ocorrer antes de sua invocação.

Papéis atuais do CRM são `admin`, `manager`, `finance`, `commercial`, `operations`, `viewer`. `owner`, `operator` e `analyst` não existem no schema confirmado; não foram inventados. Usuários ativos podem ler a visão sanitizada segundo RLS; somente `admin` altera.

## Registro legado

`register_legacy_whatsapp_connection` é uma RPC restrita a service role, a ser usada somente por comando administrativo que já tenha validado organização/papel. Recebe IDs não secretos em runtime, gera UUID real, cria `draft`, usa:

```json
{"legacy":true,"source":"environment_variables"}
```

A referência é `env://legacy-default`. Nenhum token entra na tabela ou migration. Não há ativação automática. Variáveis legadas permanecem.

## Registry MugoZap

`connection_registry.py` define:

- `WhatsAppConnection`;
- `ConnectionStatus`;
- `ConnectionResolution`;
- `ConnectionCapabilities`;
- `ConnectionHealth`;
- resolução por connection UUID ou phone number ID;
- validação de organization/workspace/status;
- falha determinística para ausente, duplicada, desativada, degradada, incompleta ou cross-tenant.

Não há fallback para default. `legacy_environment_connection_loader` só existe com flag explícita e retorna `draft`.

## Credential provider

`credential_provider.py` oferece `CredentialProvider` e `LegacyEnvironmentCredentialProvider`.

O provider legado:

- aceita apenas `env://legacy-default`;
- exige flag própria;
- lê envs existentes sem modificá-las;
- compara WABA, phone ID e Graph version com a conexão;
- retorna `MetaCredentials` somente internamente;
- possui representação redigida;
- nunca é serializado pela API.

Não há criptografia caseira.

## Feature flags

```text
WHATSAPP_CONNECTIONS_V2=false
WHATSAPP_CONNECTIONS_V2_READ_MODE=shadow
WHATSAPP_LEGACY_CONNECTION_ENABLED=false
WHATSAPP_LEGACY_CREDENTIAL_PROVIDER_ENABLED=false
```

`false`: V1 é integralmente autoritativo.  
`shadow`: resolve/compara e continua V1.  
`active`: reservado para sprint posterior; nenhum fluxo foi migrado.

## Shadow do webhook

Com V2 habilitado e read mode `shadow`:

1. lê `metadata.phone_number_id`;
2. resolve no registry;
3. compara o workspace resolvido com o legado;
4. registra `connection_shadow_match`, `connection_shadow_mismatch` ou `connection_shadow_not_found`;
5. continua exatamente o processamento V1.

Phone ID completo não entra no log.

## Health

Modelo sanitizado:

```json
{
  "configuration":"ok",
  "credentials":"unknown",
  "meta_access":"unknown",
  "waba_access":"unknown",
  "phone_access":"unknown",
  "webhook":"unknown",
  "last_checked_at":null,
  "error_code":null
}
```

Não faz chamada Meta nesta sprint.

## API da Edge

Operações locais e desligadas por flag:

- `list_whatsapp_connections`;
- `get_whatsapp_connection`;
- `get_whatsapp_connection_health`;
- `validate_whatsapp_connection`;
- `resolve_whatsapp_connection_shadow`.

JWT, profile, organization e role continuam validados. Consultas usam view/RPC com RLS. Respostas não contêm workspace, IDs Meta nem referências.

## API interna MugoZap

- `GET /api/v2/connections/{connection_id}/health`;
- `POST /api/v2/connections/resolve`.

As rotas exigem HMAC interno com timestamp, método, path e hash do body. Não aceitam `PANEL_API_KEY`. A resolução usa organization + connection e obtém workspace do registry. Workspace enviado no envelope precisa coincidir.

## Erros

`CONNECTION_NOT_FOUND`, `CONNECTION_FORBIDDEN`, `CONNECTION_DISABLED`, `CONNECTION_DEGRADED`, `CONNECTION_CONFIGURATION_MISSING`, `CONNECTION_CREDENTIALS_UNAVAILABLE`, `CONNECTION_TENANT_MISMATCH`, `CONNECTION_DUPLICATE_PHONE_ID`, `CONNECTION_REGISTRY_UNAVAILABLE`.

Health oculta mismatch como not found para não revelar outro tenant.

## Rollout

1. Validar os dois ambientes e hashes.
2. Revisar/aplicar migration em ambiente controlado.
3. Registrar `legacy-default` como draft.
4. Validar organization/workspace e projeção.
5. Habilitar `WHATSAPP_CONNECTIONS_V2=true`.
6. Manter `READ_MODE=shadow`.
7. Observar divergências sem mudar V1.
8. Validar duas conexões isoladas.
9. Considerar `active` somente em sprint posterior.

## Rollback

- Definir `WHATSAPP_CONNECTIONS_V2=false`.
- Manter tabela e registros sem uso.
- Desligar loader/provider legado se necessário.
- Preservar V1, envs, logs seguros, debug bloqueado e assinatura do webhook.
- Down documentado, não automático: revogar RPCs/view, remover policies/triggers/functions e, por último, `drop table whatsapp_connections`. Não apagar dados em rollback operacional.
# Atualização Sprint 1.2

O CRM permanece canônico. O registry operacional e a outbox foram preparados localmente em migrations distintas, com canal HMAC, versão monotônica, replay idempotente e reconciliação somente dry-run. Nenhuma migration foi aplicada e `WHATSAPP_CONNECTIONS_V2` continua desligada.
