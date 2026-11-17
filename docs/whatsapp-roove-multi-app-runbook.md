# ROOVEWHATS — homologação sem alterar o legado

## Escopo do PR
O webhook original do CRM continua ativo para a integração legada (sem query string).
Novos Meta Apps usam o MESMO Edge Function com seletor `meta_app_id`; **antes de ler o body**,
a assinatura é conferida pelo App Secret selecionado. Após a assinatura, cada entrada é
conferida contra `metadata.meta_app_id`, `waba_id` e `phone_number_id` da conexão canônica.
Envios diretos via `mugozap-api`, replies do webhook, IA comercial, automações e cobranças
resolvem tokens pela conexão. Não há fallback de token legado para clientes novos.

O registro canônico continua `public.whatsapp_connections`; sem nova tabela.
O App ID não é segredo; tokens e App Secret nunca entram em `metadata`.

## Dados do primeiro cliente
- Aplicativo Meta: ROOVEWHATS
- App ID: `1161210926623351`
- Business ID: `1343299754263536`
- WABA ID: `1491824329400600`
- Phone Number ID: `1063683626819387`
- Número: `+5511944706392`
- Número principal `+5511974858863`: NÃO ALTERAR.

## ENV adicionais (no MESMO projeto Supabase CRM, sem sobrescrever as existentes)
- `META_APP_1161210926623351_APP_SECRET`: App Secret do ROOVEWHATS (Meta Developers > Configurações > Básico)
- `META_APP_1161210926623351_WEBHOOK_VERIFY_TOKEN`: segredo **gerado pelo operador**, 32+ bytes aleatórios; mesmo valor usado na Meta em Verificar token
- `META_APP_1161210926623351_ACCESS_TOKEN`: token de usuário de sistema autorizado para a conta Roove, com permissões relevantes WhatsApp

Para cada Meta App futuro, os mesmos nomes com o próprio App ID, sem alterar código.

Para dois clientes sob o mesmo Meta App, cada conexão pode usar
`credential_reference = 'env://connection/<UUID da conexão>'`, com segredo
`WHATSAPP_CONNECTION_<UUID_COM_HIFENS_SUBSTITUIDOS_POR_UNDERSCORES>_ACCESS_TOKEN`.
Esse mecanismo é intermediário; para onboarding totalmente self-service,
integrar futuramente um Vault/secret manager por conexão e Embedded Signup.

## Callback para o ROOVEWHATS (usar somente APÓS deploy deste PR)
`https://hdyjuyhiybjqvxsukmbn.supabase.co/functions/v1/whatsapp-webhook?meta_app_id=1161210926623351`

A callback antiga SEM query continua reservada ao aplicativo legado.

## Cadastro canônico
1. Na interface de administração, cadastrar/verificar a **organização Roove** e obter seu UUID.
   Não usar o tenant Agência Mugô. Consultar o `workspace_id` correto antes de gravar.
2. Criar um registro `whatsapp_connections` com:
   - `organization_id`: UUID real da Roove
   - `workspace_id`: identificador operacional vinculado à Roove
   - `provider`: `meta_cloud_api`
   - `waba_id`: `1491824329400600`
   - `phone_number_id`: `1063683626819387`
   - `display_phone_number`: `+5511944706392`
   - `graph_api_version`: versão Graph vigente comprovada no ambiente
   - `credential_reference`: `env://meta-app-1161210926623351`
   - `webhook_verify_reference`: referência opaca não secreta (ex.: `env://meta-app-1161210926623351`)
   - `metadata`: `{"meta_app_id":"1161210926623351"}`
   - `status`: **connecting** inicialmente; `active` somente após verificar credenciais / app / WABA.
3. Nunca gravar App Secret, Access Token nem Verify Token na tabela, no frontend ou nos logs.
4. Verificar permissões do usuário de sistema e a assinatura do app na WABA.

## Teste controlado
1. Testar verificação GET com token certo / errado, assinatura HMAC correta / incorreta,
   app desconhecido e tentativa de usar segredo do app A para app B.
2. Validar que WABA, Meta App ID e Phone Number ID correspondem à conexão Roove.
3. Testar idempotência: webhook repetido não duplica mensagem.
4. Simular inbound em Roove e Mugô e verificar organização isolada.
5. Testar o envio em ambiente de homologação usando número autorizado e aprovação do responsável.
6. Checar registros / logs de 401, 403, 503 e resultados do envio.
7. Assinar o campo `messages` na configuração da Meta depois da verificação.
8. Não ligar IA e automações da Roove antes de homologar envio e transferência humana.

## Deploy (não executado por este PR)
Validar localmente / CI antes de qualquer deploy. Depois de aprovação,
publicar Edge Functions alteradas: `whatsapp-webhook`, `mugozap-api`,
`commercial-ai-worker`, `whatsapp-automation-worker`,
`collection-notification-worker`.
Verificar configurações `verify_jwt`, segredos e integridade do legado.

## Limites conhecidos
- Não há onboarding Meta Embedded Signup neste PR.
- Token ainda fica em secret do Supabase, não em Vault por tenant.
- Para múltiplos números da MESMA organização, operações sem `connection_id` explícito
  falham com `CONNECTION_SELECTION_REQUIRED` (fail-closed), até a interface permitir selecionar.
- Não foi feito deploy, criado tenant Roove, adicionado secret nem enviado WhatsApp real.
