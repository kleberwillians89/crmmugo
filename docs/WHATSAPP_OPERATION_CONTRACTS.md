# Contratos operacionais do WhatsApp

Fonte de verdade: `src/services/whatsapp/operationContracts.js` e `supabase/functions/mugozap-api/index.ts`.

| Operação CRM | Payload principal | Edge → MugoZap | Timeout | Observação |
|---|---|---|---:|---|
| `health` | `{}` | `GET /health` | 8 s | Cache de 60 s; sem polling |
| `list_conversations` | `{ limit }` | `GET /api/conversations` | 15 s | Cache de 30 s |
| `list_messages` | `{ waId, limit }` | `GET /api/messages?wa_id=...&limit=...` | 15 s | Cache por conversa de 15 s |
| `send_manual_message` | `{ waId, text }` | `POST /api/conversations/{waId}/send` | 20 s | Escrita sem retry automático |
| `assign_conversation` | `{ waId, assignedTo }` | `PATCH /api/attendance/conversations/{waId}/assign` | 20 s | Escrita protegida contra clique duplo |
| `pause_automation` | `{ waId }` | `PATCH /api/conversations/{waId}` | 20 s | Define atendimento humano e pausa o bot |
| `resume_automation` | `{ waId }` | `POST /api/conversations/{waId}/handoff/close` | 20 s | Escrita sem retry automático |
| `close_conversation` | `{ waId }` | `PATCH /api/conversations/{waId}` | 20 s | Define `status: closed` |
| `find_conversation_by_phone` | `{ phone }` | `GET /api/conversations/by-phone/{phone}` | 8 s | Cache de 30 s |
| `start_template_conversation` | IDs do cliente/parcela, telefone, template e idioma | `POST /api/conversations/start-template` | 20 s | Validação financeira e reserva contra duplicidade |
| `get_template_status` | `{ template_name }` | `GET /api/templates/{name}?language=pt_BR` | 8 s | Cache de 10 min; concorrência máxima 3 |
| `get_usage` | `{ days }` | `GET /api/whatsapp/usage?days=...` | 8 s | Cache de 5 min |

Operações do briefing que não são endpoints do MugoZap:

- `batch_collection_alerts`: orquestra chamadas individuais a `start_template_conversation`; não existe envio em lote opaco no upstream.
- `mark_collection_negotiation`: atualização da tabela `whatsapp_collection_alerts` no Supabase.
- `mark_installment_paid`: confirmação financeira no CRM e atualização de `whatsapp_collection_alerts`.

Essas operações permanecem no contrato central para deixar explícita sua natureza, mas não foram transformadas em rotas fictícias do MugoZap.

## Resposta de erro

```json
{
  "ok": false,
  "code": "UPSTREAM_TIMEOUT",
  "message": "O MugoZap demorou para responder.",
  "status": 504,
  "upstream_status": 0,
  "retryable": true
}
```

O frontend preserva `code`, `message`, `status`, `upstream_status` e `retryable`. Leituras idênticas em andamento compartilham a mesma Promise. Escritas não são repetidas automaticamente.
