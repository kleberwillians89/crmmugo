# Sprint 1.3 — projeção HMAC ponta a ponta

Status local: concluída. Estado remoto: não homologado. Data: 2026-07-28.

## Resultado

O fluxo CRM → outbox → worker → HMAC → MugoZap → ledger/registry foi fechado localmente sem chamadas Meta ou envio de mensagens. Duas conexões inteiramente fictícias validaram isolamento, replay, conflito, versionamento e estados não executáveis.

O endpoint canônico é `POST /internal/v1/whatsapp/connections/project`; o alias `/api/v2/internal/connections/project` permanece para compatibilidade. A reconciliação é somente dry-run e o shadow não muda o resultado V1.

## Estado remoto observado

- CRM: o projeto está linkado, mas o CLI local não possui access token. Catálogo remoto não consultado.
- MugoZap: a tentativa somente leitura ao OpenAPI retornou HTTP 401. Nenhum dado foi lido.
- Portanto, a aplicação das migrations é informação fornecida pelo contexto, não evidência obtida nesta execução.
- Colunas, constraints, índices, triggers, policies e grants locais estão documentados nas migrations; sua equivalência remota permanece pendente.

## Testes fictícios

- Conexões A e B: aplicadas isoladamente.
- Replay idêntico: `replayed`.
- Mesmo event ID/body diferente: HTTP 409.
- Versão menor positiva: `ignored_stale`, HTTP 409.
- Versão maior: aplicada.
- Organização ou workspace alterado: HTTP 409.
- Phone number ID duplicado: HTTP 409.
- Assinatura inválida, expirada ou futura: HTTP 401.
- Secret ausente: HTTP 503 fail-closed.
- `disabled` e `revoked`: preservados.
- `access_token`/campos secretos: rejeitados antes do repository.

## Decisão

**GO COM RESTRIÇÕES** apenas para preparar deploy controlado. Continua **NO-GO para ativação** do worker/projeção até confirmar catálogos remotos, aplicar o hardening incremental no CRM, configurar HMAC e executar homologação fictícia autorizada com rollback imediato.
