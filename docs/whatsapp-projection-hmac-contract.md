# Contrato HMAC da projeção WhatsApp

Versão: `v1`. Algoritmo: HMAC-SHA256.

Headers:

```text
X-Mugo-Event-Id: <uuid>
X-Mugo-Timestamp: <unix-seconds>
X-Mugo-Signature-Version: v1
X-Mugo-Signature: v1=<64 hex>
```

Canonical string:

```text
v1
{event_id}
{timestamp}
{sha256_hex_do_body_raw}
```

A assinatura é HMAC-SHA256 da canonical string. O body assinado é exatamente o body enviado. A comparação é constante. O header event ID deve coincidir com o payload.

Variáveis canônicas:

- MugoZap: `MUGOZAP_INTERNAL_HMAC_SECRET`, `MUGOZAP_INTERNAL_HMAC_MAX_AGE_SECONDS`, `MUGOZAP_INTERNAL_HMAC_CLOCK_SKEW_SECONDS`.
- Worker: `MUGOZAP_INTERNAL_BASE_URL`, `MUGOZAP_INTERNAL_HMAC_SECRET`.

Aliases temporários: `MUGOZAP_INTERNAL_V2_SECRET` e `MUGOZAP_API_URL`. `PANEL_API_KEY` nunca participa.

Falhas: 401 para assinatura/header/tempo; 400 para estrutura inválida; 409 para replay conflitante, stale ou tenant/version conflict; 503 para secret/registry indisponível. Replay idêntico retorna 200 `replayed`.
