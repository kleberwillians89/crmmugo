# Sprint 14.1 — operação

A migration `202607140006_sprint14_1_operational_audit.sql` é apenas um artefato versionado. Ela não é executada pelo build, pelos testes ou pela aplicação. Revise em staging, faça snapshot do banco e aplique manualmente antes de liberar as páginas.

Defina `VITE_APP_VERSION` e `VITE_SENTRY_DSN`. O frontend captura exceções globais, rejeições, sanitiza chaves sensíveis e produz logs estruturados. Para envio remoto, conecte o SDK oficial do Sentry em `src/lib/observability.js`.

Execute `npm run test:stress` para medir tempo, memória e renderização simulada. Testes reais de queries devem rodar somente em staging.
