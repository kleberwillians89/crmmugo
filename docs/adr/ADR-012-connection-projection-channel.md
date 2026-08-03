# ADR-012 — canal de projeção de conexões

Status: aceito e implementado localmente; aplicação/deploy pendentes  
Data: 2026-07-28

## Contexto

ADR-011 definiu o CRM como origem canônica e o MugoZap como registry operacional. A Sprint 1.1 confirmou projetos Supabase separados (`***kmbn` e `***eyxy`). Não é possível depender de join, trigger cross-database ou Supabase compartilhado.

## Decisão

Usar projeção assíncrona por outbox:

1. alteração canônica e evento de outbox são persistidos na mesma transação no CRM;
2. worker/control-plane lê a outbox;
3. envia envelope versionado ao endpoint interno do MugoZap;
4. request é assinado por HMAC com timestamp, path, método e hash do body;
5. MugoZap valida assinatura e versão;
6. faz upsert idempotente no `whatsapp_connection_registry` pelo UUID canônico;
7. devolve versão aplicada;
8. CRM marca o evento como projetado.

Não usar `PANEL_API_KEY`, JWT de usuário, service role cruzada ou chamada direta do frontend.

## Contrato mínimo

O envelope inclui `event_id`, connection/organization/workspace IDs, versão monotônica, configuração não secreta, referências opacas e `occurred_at`. Não inclui token, app secret, verify token ou conteúdo de mensagens.

## Registry operacional

Migration separada no Supabase MugoZap:

- tabela não pública;
- unique em connection UUID e provider+phone ID;
- status/configuração validados;
- `projected_version` monotônica;
- `projected_at` e `source_updated_at`;
- grants fechados para anon/authenticated;
- acesso somente pelo serviço interno.

Credenciais são resolvidas internamente pela referência opaca.

## Falhas e reconciliação

- Retry usa `event_id` e versão.
- Evento antigo não sobrescreve versão nova.
- Falha não troca tenant nem usa default.
- Registry ausente em V2 falha fechado.
- Reconciliação compara UUID, versão e hash sanitizado.
- Em shadow, divergência é registrada e V1 continua.

## Segurança

- HMAC secret distinto de PANEL key e credenciais Meta.
- Rotação controlada com duas versões de chave.
- Replay bloqueado por timestamp e event ID persistido.
- Logs guardam IDs de request/event/connection, nunca assinatura.
- Endpoint não é exposto ao navegador.

## Alternativas rejeitadas

- Compartilhar service role entre projetos.
- Frontend escrever nos dois Supabase.
- Duplicação manual.
- Consulta síncrona ao CRM em cada webhook.
- Criptografia própria de token.

## Rollout

1. validar schemas e hashes;
2. aplicar canonical em staging CRM;
3. aplicar registry em staging MugoZap;
4. configurar assinatura interna;
5. projetar legacy draft;
6. reconciliar;
7. habilitar V2 em shadow;
8. testar duas conexões;
9. active somente em sprint posterior.

## Rollback

Desligar produtor/worker e `WHATSAPP_CONNECTIONS_V2`; preservar outbox e registry para diagnóstico; continuar V1. Não apagar dados nem reabrir debug.

## Implementação Sprint 1.2

O contrato foi materializado nas migrations `202607280002_whatsapp_connection_outbox.sql` (CRM) e `202607280001_whatsapp_connection_registry.sql` (MugoZap). O worker permanece dry-run e as flags de projeção/reconciliação permanecem `false`, portanto esta decisão ainda não altera tráfego.
