# Sprint 0 — implementação de segurança e contrato

## Resultado

Implementação local concluída, sem deploy, migrations ou envios reais.

## Arquivos

Backend:

- `server/security_logging.py`;
- `server/webhook_security.py`;
- `server/tenant_context_v2.py`;
- `server/services/whatsapp.py`;
- `server/services/state.py`;
- `server/services/ai_state.py`;
- `server/services/sales_brain.py`;
- `server/services/mugo_flow.py`;
- `server/services/followup.py`;
- `server/services/openai_client.py`;
- `server/debug_logs.py`;
- `server/app.py`;
- `server/.env.example`;
- `server/tests/*`.

Documentação:

- `docs/whatsapp-sprint-0-inventory.md`;
- `docs/mugozap-debug-endpoints.md`;
- `docs/mugozap-tenant-context-v2.md`;
- `docs/mugozap-idempotency-gap.md`;
- este documento.

O `eslint.config.js` do CRM passou a ignorar `mugozap-backend/**`, porque o backend aninhado é um projeto independente. Isso não altera bundle ou UX.

## Comportamento implementado

- Logs estruturados com allowlist e sanitização central.
- Tokens eliminados; telefone/identificadores mascarados; conteúdo reduzido a tipo/tamanho/hash.
- Respostas de erro Meta reduzidas a código/tipo/retryable.
- Debug desligado por padrão, admin obrigatório, PANEL key proibida e allowlist para envio.
- HMAC SHA-256 do body bruto com `compare_digest`.
- Modos `off`, `report` e `enforce`; padrão documentado `report`.
- Body do webhook limitado a 1 MiB; GET challenge preservado.
- Parser/envelope V2 não destrutivo, ator autenticado e workspace server-side.
- Rotas e headers V1 preservados.
- Caracterização explícita da falta de idempotência persistida.

## Flags

```text
WHATSAPP_SIGNED_WEBHOOKS_MODE=report
MUGOZAP_DEBUG_ENDPOINTS_ENABLED=false
WHATSAPP_TENANT_CONTEXT_V2=false
```

## Testes e comandos

```bash
PYTHONPATH=. python3 -m unittest discover -s tests -v
python3 -m py_compile app.py security_logging.py webhook_security.py tenant_context_v2.py services/whatsapp.py
npm run lint
npm run build
```

Resultado final: 22 testes executados, 19 passaram e 3 falhas esperadas de caracterização. Compilação Python, lint e build do CRM aprovados. O build manteve apenas o aviso preexistente de chunk acima de 500 kB. `ruff` e `mypy` não estão instalados no ambiente, portanto seus comandos foram tentados e registrados como indisponíveis; não foram instaladas dependências novas. O lint separado do frontend MugoZap apontou duas falhas preexistentes registradas no inventário. Nenhuma chamada externa foi feita.

## Preservado

- Inbox, envio manual/template, cobrança, webhook, health e autenticação V1.
- `X-Workspace-Id`, `PANEL_API_KEY`, rotas e variáveis legadas.
- Alterações preexistentes presentes no ZIP.
- Nenhuma mudança de UX do CRM.

## Riscos remanescentes

- Logs legados de fluxo/IA ainda existem no código, mas seus argumentos são suprimidos por `legacy_safe_print`; a substituição semântica desses sinais por eventos próprios deve continuar incrementalmente.
- Não existe registry comprovado de conexão/tenant.
- Idempotência de saída continua sem persistência.
- Produção pode divergir do ZIP.
- `report` só gera validação útil quando `META_APP_SECRET` está configurado corretamente.

## Plano de deploy

1. Confirmar hash/schema real e separar alterações preexistentes.
2. Criar artefato somente do backend; não publicar CRM/Edge.
3. Configurar apenas nomes/valores das flags por processo existente, sem exibi-los.
4. Publicar com debug falso, V2 falso e assinatura `report`.
5. Verificar health, GET challenge, inbox e envios existentes sem realizar envio real de homologação.
6. Observar `webhook_signature_checked` por uma janela definida.
7. Só avaliar `enforce` em mudança posterior aprovada.

## Rollback

1. Reimplantar a imagem/commit anterior do MugoZap.
2. Alternativamente, definir `WHATSAPP_SIGNED_WEBHOOKS_MODE=off` e `WHATSAPP_TENANT_CONTEXT_V2=false`.
3. Manter `MUGOZAP_DEBUG_ENDPOINTS_ENABLED=false`.
4. Não reverter CRM, Edge ou banco: não foram alterados funcionalmente nesta sprint.

## Checklist manual

- [ ] Hash implantado confirmado.
- [ ] Schema dos dois Supabase inventariado sem dados.
- [ ] `META_APP_SECRET` presente.
- [ ] Debug retorna 404 em produção.
- [ ] GET challenge retorna challenge.
- [ ] POST assinado gera `valid`.
- [ ] POST sem assinatura em `report` continua aceito.
- [ ] Nenhum token, telefone completo ou conteúdo aparece no agregador de logs.
- [ ] Inbox e contratos V1 continuam respondendo.
- [ ] Nenhum envio real executado.

## Próxima sprint

Criar registry de `whatsapp_connections` e idempotência persistida antes de campanhas ou automações. A migração deve ser aditiva, com adapter V1 e testes transacionais de concorrência.
