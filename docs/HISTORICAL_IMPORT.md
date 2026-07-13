# Importação histórica

Exporte e normalize JSON, substitua IDs de exemplo pelos UUIDs reais e execute `node scripts/import/import-clients.mjs arquivo.json --dry-run`. Corrija inválidos, faça backup e só então use `--commit` em ambiente local seguro com `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` server-side.

Importe na ordem clientes, propostas, contratos e documentos. `legacy_id` e resolução de conflito evitam duplicação em propostas/contratos. Os scripts produzem contagens e nunca imprimem chaves. Documentos exigem upload privado prévio; o script permanece dry-run para evitar metadados sem arquivo.
