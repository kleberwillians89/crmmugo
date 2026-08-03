# Sprint 1 — implementação

## Resultado

Estrutura multicliente implementada localmente e protegida por flags. Nenhum deploy, migration remota, secret ou envio real ocorreu. O modo active não foi habilitado.

## Plano executado

1. gate ambiental;
2. ADR de armazenamento;
3. schema/RLS sanitizado;
4. registry e credential provider;
5. Edge V2 de leitura;
6. API interna assinada;
7. shadow do webhook;
8. testes e documentação.

## Arquivos alterados

CRM:

- `supabase/migrations/202607280001_whatsapp_connections_v2.sql`;
- `supabase/tests/whatsapp_connections_v2_rls.sql`;
- `supabase/functions/mugozap-api/index.ts`;
- `scripts/test-whatsapp-connections-v2.mjs`;
- `package.json`.

MugoZap:

- `server/connection_registry.py`;
- `server/credential_provider.py`;
- `server/internal_auth.py`;
- `server/tenant_context_v2.py`;
- `server/app.py`;
- `server/.env.example`;
- testes em `server/tests/`.

Documentação:

- `docs/whatsapp-sprint-1-environment-validation.md`;
- `docs/adr/ADR-011-whatsapp-connections-storage.md`;
- `docs/whatsapp-connections-v2.md`;
- este documento.

## Migration

É incremental e possui tabela, constraints, índices, FORCE RLS, policies, grants por coluna, trigger de imutabilidade, view/RPC sanitizadas e registro legado seguro. Está marcada como **PREPARAR APENAS**.

O teste SQL RLS foi criado, mas não executado: o schema remoto não foi alterado e o ambiente local não possui Docker/Postgres preparado. A aplicação antes do gate é proibida.

## Testes

Comandos:

```bash
npm run test:whatsapp-connections-v2
PYTHONPATH=. python3 -m unittest discover -s tests -v
python3 -m compileall -q app.py connection_registry.py credential_provider.py internal_auth.py tenant_context_v2.py services tests
npm run lint
npm run build
git diff --check
```

Resultados intermediários:

- contrato CRM/migration/Edge: aprovado;
- MugoZap: 33 testes, 30 aprovados e os mesmos 3 `expectedFailure` de idempotência;
- compilação Python: aprovada;
- testes WhatsApp V1 (`stability`, `templates`, `incremental`, `contextual`): aprovados;
- lint e build do CRM: aprovados, com aviso não bloqueante de chunk acima de 500 kB;
- `git diff --check`: aprovado nos dois projetos;
- `deno check` indisponível porque Deno não está instalado;
- teste SQL RLS não executado porque a migration não foi aplicada e não há Postgres/Docker local;
- nenhuma chamada externa.

Cobertura: conexão válida/ausente/disabled/degraded, tenant/workspace mismatch, phone duplicado, credencial ausente, legado, provider, HMAC interno, health sanitizado, workspace arbitrário, dois phone IDs, shadow match/mismatch/not-found, webhook assinado e compatibilidade V1.

## Compatibilidade

V1 não foi migrado. Inbox, envio manual, template, cobrança, conversas, webhook, follow-ups, health, autenticação, `X-Workspace-Id` e envs globais permanecem.

`WHATSAPP_CONNECTIONS_V2=false` é o default. `READ_MODE=shadow` não altera tenant efetivo.

## Riscos e pendências

- Hash implantado do MugoZap desconhecido.
- Supabase do MugoZap confirmado como projeto distinto; canal de projeção ainda não definido.
- O schema remoto do MugoZap possui as três tabelas WhatsApp, mas não possui `workspaces`, `profiles`, `organizations` ou templates.
- Policies/constraints/índices remotos completos não exportados.
- RLS SQL ainda precisa rodar em banco isolado.
- Papéis owner/operator/analyst não existem no CRM atual.
- Projeção operacional persistente ainda precisa de contrato de transporte.
- Idempotência de saída permanece pendente.
- Working tree do ZIP possui mudanças preexistentes.

## Checklist de rollout

- [ ] Confirmar hash do MugoZap implantado.
- [x] Confirmar project-ref mascarado do MugoZap.
- [ ] Exportar schemas sem dados.
- [ ] Revisar migration com DBA/security.
- [ ] Executar teste RLS em ambiente isolado.
- [ ] Aplicar migration controlada.
- [ ] Criar legacy draft por comando administrativo.
- [ ] Implementar/validar projeção por UUID.
- [ ] Habilitar V2, mantendo shadow.
- [ ] Observar match/mismatch/not-found.
- [ ] Validar duas organizações e dois phone IDs.
- [ ] Não ativar active nesta sprint.

## Rollback

1. `WHATSAPP_CONNECTIONS_V2=false`;
2. `WHATSAPP_LEGACY_CONNECTION_ENABLED=false`;
3. manter V1 e tabela sem uso;
4. não apagar conexões nem secrets;
5. não reabrir debug;
6. manter assinatura e sanitização;
7. reimplantar artefato anterior se necessário.

Down lógico: revogar objetos públicos e remover funções/view/policies/triggers antes da tabela. Não executar automaticamente.

## Próxima sprint

Antes de campanhas, implementar a projeção autenticada CRM → MugoZap e idempotência persistida de comandos de saída, com concorrência e reconciliação testadas.
