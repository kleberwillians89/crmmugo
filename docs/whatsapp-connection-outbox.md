# Outbox de conexões do CRM

`public.whatsapp_connection_outbox` pertence ao Supabase do CRM/control-plane. A trigger grava o evento na mesma transação da conexão, de modo que alteração e evento confirmam ou revertem juntos.

Estados: `pending`, `processing`, `delivered`, `failed`, `dead_letter`. Há unicidade por `event_id` e por conexão/versão, tentativas, próxima tentativa e lock temporário. O claim usa `FOR UPDATE SKIP LOCKED`.

O payload é sanitizado no banco, possui UUID canônico, tenant, versão, configuração Meta não secreta, telefone mascarado e referência opaca. Uma constraint recursiva bloqueia chaves de segredo. `anon` e `authenticated` não possuem acesso; somente `service_role` do próprio CRM pode operar a fila.

O worker nasce desligado por `WHATSAPP_CONNECTION_OUTBOX_WORKER_ENABLED=false`. Em dry-run ele valida sanitização, serialização canônica e hash sem rede nem alteração de estado. O caminho executável implementa claim transacional, HMAC, timeout de 12 segundos, entrega, backoff, dead-letter e circuit breaker, mas somente fica acessível após habilitação explícita futura. A validação legacy `--validate-legacy` informa apenas validade/presença, sem imprimir IDs.
