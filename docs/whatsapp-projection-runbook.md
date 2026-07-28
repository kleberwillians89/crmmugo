# Runbook de projeção

## Pré-condições

1. Confirmar migrations e catálogo nos dois Supabase.
2. Aplicar em staging o hardening incremental `202607280003_whatsapp_projection_secret_hardening.sql`.
3. Confirmar branch/commit e comandos do Render.
4. Configurar o mesmo HMAC forte nos dois serviços, sem imprimir valor.
5. Manter todas as flags false.

## Homologação controlada

1. Executar suites locais.
2. Criar conexões A/B fictícias, sem IDs Meta reais.
3. Confirmar evento sanitizado na outbox.
4. Ativar somente o worker em dry-run; confirmar que não houve PATCH/POST.
5. Ativar temporariamente o endpoint em staging.
6. Executar uma projeção, replay e conflito de hash.
7. Confirmar ledger e registry por consulta sanitizada.
8. Projetar B e testar isolamento.
9. Executar reconciliação dry-run.
10. Desligar todas as flags.

## Render

Registrar nome do serviço, branch, commit, build command, start command, nomes das envs, data do deploy e versão de schema. O repositório local não possui `render.yaml`; esses dados devem ser confirmados no painel. O endpoint `/internal/build-info` fica desligado e nunca retorna envs.
