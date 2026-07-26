# Sincronização e envio de templates do WhatsApp

O CRM consulta os templates exclusivamente na Edge Function `mugozap-api`. A operação
`sync_templates` usa `WABA_ID` no endpoint `/{WABA_ID}/message_templates`, busca nome e
idioma e persiste o catálogo em `whatsapp_message_templates`. `ACTIVE` e `APPROVED` são
estados disponíveis; a ausência de uma pontuação de qualidade não bloqueia o envio.

O envio individual continua no endpoint existente do MugoZap
`POST /api/conversations/start-template`, preservando automações, webhooks e histórico.
Antes de encaminhar, a Edge Function valida o `PHONE_NUMBER_ID`, localiza o template na
Meta por nome e idioma, confere estado e quantidade de variáveis de BODY/HEADER,
normaliza o telefone e cria uma reserva `sending` contra clique duplo. O sucesso só é
gravado quando o provedor retorna um ID de mensagem.

## Secrets obrigatórios da Edge Function

- `WABA_ID`: conta do WhatsApp Business usada somente para listar templates.
- `PHONE_NUMBER_ID`: número remetente usado para validar a configuração de envio.
- `META_ACCESS_TOKEN`: token server-side; nunca deve usar prefixo `VITE_`.
- `GRAPH_API_VERSION`: versão explícita no formato `vNN.N`.
- `MUGOZAP_API_URL` e `PANEL_API_KEY`: integração já existente com o MugoZap.

Antes do deploy, aplique a migration
`202607260001_whatsapp_template_sync_audit.sql`, configure os secrets sem colocá-los no
frontend e publique novamente a Edge Function. Nenhum secret é alterado pelo código.
