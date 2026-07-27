# Auditoria técnica WhatsApp/Meta — 2026-07-27

## Arquitetura encontrada

`WhatsAppTemplatesPanel` usa `templateCatalog.js`, que chama
`whatsappRepository.js`. O repositório envia uma operação autenticada para a Edge
Function `mugozap-api`. A função valida o JWT e o `profile`, consulta a Graph API
com `WABA_ID`, persiste o catálogo no Supabase e devolve os dados ao frontend.
Conversas, mensagens, envio efetivo, webhook e métricas continuam pertencendo ao
MugoZap, acessado pela mesma Edge Function.

O projeto Supabase vinculado no repositório é `crm_mugo`, referência
`hdyjuyhiybjqvxsukmbn`. A versão remota não pôde ser inspecionada sem login da CLI.

## Problemas encontrados e correções

- O frontend novo usava `sync_templates`, mas o deploy remoto relatado ainda usava
  uma função sem essa rota. A operação existe localmente e deve ser publicada.
- A tela mostrava apenas sete nomes fixos. Agora o catálogo completo retornado pela
  Meta é preservado.
- A tela não lia o Supabase antes da Meta. Agora `list_templates` carrega os dados
  locais primeiro e a sincronização ocorre em seguida.
- A persistência não isolava WABAs e descartava metadados. A migration incremental
  adiciona `waba_id`, payload bruto, motivo de rejeição, formato de parâmetros,
  timestamps da Meta e `is_active`; a unicidade passa a ser organização + WABA +
  nome + idioma.
- Falha de upsert era tratada como sucesso. Agora interrompe a operação com erro
  padronizado.
- Templates ausentes eram indefinidos. Agora só são marcados inativos após todas as
  páginas serem obtidas e persistidas com sucesso; falha da Meta não desativa nada.
- O cache manual não era invalidado explicitamente. A sincronização invalida leituras
  do catálogo e status.
- `ACTIVE` era aceito no envio. O fluxo agora permite somente o status oficial
  `APPROVED`.
- Botões `copy_code` não eram validados. O backend bloqueia cupom vazio.
- Erros não tinham correlação. Cada resposta recebe `X-Request-Id`; erros incluem
  `request_id` e detalhes sanitizados da Meta.
- O painel de custos agora distingue confirmado, estimado e indisponível.

## Limites comprovados

Não existe webhook da Meta neste repositório. Também não existe aqui o cálculo de
pricing do MugoZap. Logo, assinatura do webhook, idempotência de eventos, mensagens
recebidas e custos oficiais precisam ser auditados no repositório/telemetria do
MugoZap. Criar outro webhook no CRM duplicaria a integração existente.

O uso de `WABA_ID` e `PHONE_NUMBER_ID` como secrets globais atende uma única conta
Meta por projeto. Multi-WABA por organização exige um modelo de credenciais
server-side próprio; não deve ser simulado no frontend.

## Deploy

Com a CLI autenticada e após confirmar a referência acima:

```bash
supabase db push --project-ref hdyjuyhiybjqvxsukmbn
supabase functions deploy mugozap-api --project-ref hdyjuyhiybjqvxsukmbn
```

Secrets exigidos pela função: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`MUGOZAP_API_URL`, `PANEL_API_KEY`, `WABA_ID`, `PHONE_NUMBER_ID`,
`META_ACCESS_TOKEN` e `GRAPH_API_VERSION`. Nenhum deles pode ter prefixo `VITE_`.
