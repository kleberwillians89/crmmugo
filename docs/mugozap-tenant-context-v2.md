# Contrato interno de tenant/contexto V2

## Objetivo

Adicionar contexto validável sem substituir V1. V1 mantém `X-Workspace-Id` e rotas atuais. V2 nunca escolhe workspace a partir do frontend.

## Modelo

`TenantContextV2`:

- `organization_id`: UUID obrigatório;
- `connection_id`: UUID obrigatório;
- `workspace_id`: resolvido no servidor;
- `actor_id`: UUID autenticado;
- `actor_role`: papel autenticado;
- `request_id`: UUID obrigatório.

## Rota inicial

`POST /internal/v2/commands`, disponível apenas com `WHATSAPP_TENANT_CONTEXT_V2=true`. Aceita somente `health.check` e `context.echo`; não envia mensagens e não consulta a Meta.

Headers internos:

- `Authorization: Bearer <sessão>` é transportado, nunca logado;
- `Content-Type: application/json`;
- V2 ignora `X-Workspace-Id` e não aceita `PANEL_API_KEY`.

Request:

```json
{
  "command": "health.check",
  "tenant": {
    "organization_id": "00000000-0000-4000-8000-000000000001",
    "connection_id": "00000000-0000-4000-8000-000000000002"
  },
  "actor": {
    "id": "00000000-0000-4000-8000-000000000003",
    "role": "admin"
  },
  "request_id": "00000000-0000-4000-8000-000000000004",
  "idempotency_key": "optional",
  "payload": {}
}
```

O ator é comparado com a sessão. O workspace é resolvido do usuário/registry. Se o cliente enviar `tenant.workspace_id`, ele só pode coincidir com o valor resolvido; não o define.

Resposta:

```json
{"ok":true,"data":{"command":"health.check","context_valid":true},"request_id":"uuid"}
```

Erro:

```json
{"ok":false,"code":"TENANT_CONTEXT_INVALID","message":"Mensagem segura","retryable":false,"request_id":"uuid"}
```

Códigos: `MALFORMED_JSON`, `INVALID_ENVELOPE`, `UNKNOWN_COMMAND`, `SECRET_IN_BODY`, `TENANT_CONTEXT_MISSING`, `TENANT_CONTEXT_INVALID`, `ACTOR_MISMATCH`, `ACTOR_ROLE_MISSING`, `WORKSPACE_MISMATCH`, `TENANT_REGISTRY_UNAVAILABLE`.

## Compatibilidade e migração

1. V2 desligado: somente V1 opera.
2. Habilitar V2 para health/echo interno.
3. Criar registry persistente de conexões em sprint posterior.
4. Fazer a Edge construir o envelope com organização derivada da sessão e connection autorizada.
5. Migrar operações uma a uma sob flag.
6. Manter adapters V1 até telemetria comprovar ausência de consumidores.

