# Endpoints de debug do MugoZap

## Inventário

| Rota | Efeito |
| --- | --- |
| `GET /api/debug/ai-state/{wa_id}` | Lê estado da IA |
| `GET /api/debug/meta-env` | Lê presença de configuração Meta |
| `POST /api/debug/send-test-whatsapp/{wa_id}` | Pode enviar mensagem real |
| `GET /api/debug/lead-state/{wa_id}` | Lê estado agregado do lead |
| `POST /api/debug/reset-lead/{wa_id}` | Altera estado |
| `POST /api/debug/simulate-incoming/{wa_id}` | Simula entrada e altera estado |

## Política da Sprint 0

- `MUGOZAP_DEBUG_ENDPOINTS_ENABLED=false` por padrão.
- Quando desabilitado, as rotas retornam 404.
- Quando habilitado, exigem sessão Supabase e papel administrativo.
- `PANEL_API_KEY` global não autoriza debug.
- O envio de teste também exige que o destinatário esteja em `MUGOZAP_DEBUG_SEND_ALLOWLIST`.
- Nenhuma flag ou allowlist é retornada pela API.
- Logs registram `debug_endpoint_blocked` sem telefone, token ou payload.

Desenvolvimento local pode habilitar a flag explicitamente. Produção deve mantê-la falsa, salvo janela controlada com usuário admin, allowlist e rollback imediato.

