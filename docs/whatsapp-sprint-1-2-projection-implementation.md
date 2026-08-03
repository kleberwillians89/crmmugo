# Sprint 1.2 — projeção de conexões

Status: implementada localmente, não aplicada e não publicada (2026-07-28).

## Entregas

- CRM: migration `202607280002_whatsapp_connection_outbox.sql`, versão monotônica e outbox transacional.
- MugoZap: migration `202607280001_whatsapp_connection_registry.sql`, registry e ledger idempotente.
- Canal: `POST /api/v2/internal/connections/project`, autenticado exclusivamente por HMAC.
- Reconciliação: `POST /api/v2/internal/connections/reconcile`, somente dry-run.
- Diagnóstico de build: `GET /api/v2/internal/build-info`, desligado por padrão.
- Worker: `scripts/whatsapp-connection-outbox-worker.mjs`, implementado mas desligado; execução desta sprint usa somente fixtures/dry-run.

Todos os recursos estão atrás de flags `false`. Não houve deploy, migration, secret ou chamada Meta.

## Fluxo

`whatsapp_connections` → trigger na mesma transação → `whatsapp_connection_outbox` → worker → HMAC → endpoint interno → RPC atômica → `whatsapp_connection_registry` + `whatsapp_projection_events`.

O evento contém apenas configuração não secreta e `credential_reference` opaca. Evento duplicado é idempotente; versão antiga é `stale`; mesma versão com hash diferente ou troca de tenant é `conflict`.

## Validação e rollout posterior

1. Aplicar migrations nos respectivos ambientes de staging.
2. Configurar segredo HMAC distinto, sem compartilhamento de service role.
3. Validar fixture com `node scripts/whatsapp-connection-outbox-worker.mjs --fixture <arquivo>`.
4. Validar projeção/replay/conflito em staging.
5. Reconciliar em dry-run.
6. Liberar o worker executável somente em sprint posterior.
7. Habilitar shadow antes de qualquer leitura ativa.

Rollback: desligar as flags; preservar outbox, registry e ledger para diagnóstico.

## Produção e Render

Decisão atual: **NO-GO para produção**. Ainda faltam aplicar e testar as duas migrations em staging, cadastrar/rotacionar o HMAC interno, confirmar replay e reconciliação com duas conexões e identificar o commit efetivamente implantado no Render.

No Render, registrar sem copiar valores: nome do serviço, branch, commit, build command, start command, nomes das variáveis configuradas e data/hora do deploy. Depois habilitar temporariamente `MUGOZAP_BUILD_INFO_ENABLED` em staging e consultar o endpoint assinado; desligá-lo após comparar commit e serviço. Nunca documentar valores de secrets.
