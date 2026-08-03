# Registry operacional do MugoZap

`public.whatsapp_connection_registry` pertence ao Supabase operacional do MugoZap. É uma projeção descartável/reconstruível do estado canônico do CRM, não uma segunda origem de verdade.

Chave: UUID canônico da conexão. Isolamento: `organization_id` e `workspace_id` são imutáveis após criação. `provider + phone_number_id` é único quando informado. Conexões `active` exigem WABA, phone number e referência de credencial.

A RPC `apply_whatsapp_connection_projection` aplica registry e ledger na mesma transação. `source_version` nunca regride. Mesmo evento/hash é duplicata segura; mesmo evento ou versão com conteúdo diferente é conflito; versão menor é stale. Registros revogados são preservados.

RLS é forçada e não existem policies para cliente. `anon` e `authenticated` não têm privilégios. O backend acessa a tabela apenas com a service role do próprio projeto operacional.
