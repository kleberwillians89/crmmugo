# Contrato de projeção de conexão

Endpoint: `POST /api/v2/internal/connections/project`.

Autenticação: HMAC SHA-256 sobre `timestamp + método + path + SHA-256(body)`, com tolerância de cinco minutos. Headers de assinatura nunca são registrados. `PANEL_API_KEY`, JWT do usuário e service role cruzada não são aceitos.

Envelope:

```json
{
  "event_id": "<uuid>",
  "event_type": "connection.updated",
  "occurred_at": "<ISO-8601>",
  "version": 2,
  "connection": {
    "id": "<uuid>",
    "organization_id": "<uuid>",
    "workspace_id": "<workspace>",
    "provider": "meta_cloud_api",
    "waba_id": "<digits>",
    "phone_number_id": "<digits>",
    "display_phone_number_masked": "***0000",
    "status": "active",
    "graph_api_version": "v23.0",
    "credential_reference": "opaque://connection/<uuid>",
    "capabilities": {},
    "connection_health": {},
    "updated_at": "<ISO-8601>"
  }
}
```

Eventos: `connection.created`, `updated`, `disabled`, `revoked`, `health_updated`.

Resultados: `applied` e `duplicate` retornam HTTP 200; `stale` e `conflict`, HTTP 409; envelope inválido, HTTP 400; autenticação inválida, HTTP 401; configuração/registry indisponível, HTTP 503; flag desligada, HTTP 404.

Campos com nomes de segredo são rejeitados recursivamente. A resposta não inclui payload, hash, credenciais ou telefone completo.
