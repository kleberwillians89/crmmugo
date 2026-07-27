# Estabilização do módulo WhatsApp

Atualizado em: 2026-07-27

Fase atual: Fase 1 — estabilização obrigatória

Estado: em andamento; produção bloqueada no checkpoint de validação autenticada

## Objetivo

Entregar o atendimento WhatsApp estável, seguro e utilizável em desktop e mobile antes de iniciar qualquer arquitetura de automações. A conclusão exige validar em produção, com sessão real, uma mensagem livre e um template aprovado, ambos enviados uma única vez e somente após aprovação explícita.

## Estado atual

- A Edge Function `mugozap-api` está publicada na versão 35.
- O commit exclusivo da Edge é `36041e4124c4516dea5fadfaec8a09b6bb852e36`.
- A verificação restrita `get_template_test_access` está publicada e exige administrador autenticado e vinculado à organização.
- A última tentativa de verificação não chegou à Edge porque a sessão do navegador estava expirada.
- `VITE_WHATSAPP_TEMPLATE_SEND_ENABLED` permanece `false`.
- O frontend de homologação ainda não foi publicado.
- Nenhuma mensagem ou template foi enviado durante esta missão.
- Há mudanças locais preexistentes do frontend, preservadas e ainda sem commit.

## Critérios da Fase 1

| Critério | Estado | Evidência ou bloqueio |
| --- | --- | --- |
| Autenticação e renovação | Corrigido localmente; falta homologar | Renovação explícita quando a sessão expira em até 60 segundos |
| Conversas | Implementado; falta produção autenticada | `list_conversations`, cache curto e polling |
| Mensagem livre dentro da janela | Implementado; falta envio aprovado | Composer e Edge usam idempotência |
| Bloqueio fora da janela | Coberto localmente | Composer bloqueado e direcionamento para template |
| Templates APPROVED | Implementado; falta consulta autenticada | Edge consulta template ativo por organização e WABA |
| Variáveis estáveis | Validado localmente | Digitação, colagem, edição intermediária e preview |
| Envio restrito de template | Edge pronta; frontend não publicado | Allowlist e template autorizados somente em secrets |
| Idempotência | Implementado | Chave obrigatória em mensagem livre e template |
| Histórico sem duplicação | Coberto localmente; falta dados reais | Mesclagem por provider ID ou idempotency key |
| Status de entrega | Implementado; falta dados reais | sent, delivered, read, failed e unknown |
| Timeout | Corrigido localmente | Resultado ambíguo fica `unknown`, sem repetição automática |
| Erros compreensíveis | Implementado | Códigos específicos e request ID |
| Desktop | Validado com fixtures; falta produção | Screenshots e testes locais |
| Mobile | Validado com fixtures; falta produção | 390×844 e 430×932 |
| Sem credenciais no frontend | Aprovado localmente | Nenhuma allowlist ou secret no bundle |
| Contrato frontend/Edge | Coberto por testes; falta homologar MugoZap | Components ordenados e modo `minimal` |
| Testes e validação autenticada | Parcial | Testes locais passam; sessão real pendente |

## Problemas encontrados e causas raiz

1. O foco dos parâmetros era reposicionado durante polling porque o efeito do drawer dependia de um callback `onClose` recriado a cada render.
2. A sessão era apenas lida com `getSession`; não havia renovação explícita imediatamente antes de operações WhatsApp quando o token estava próximo do vencimento.
3. Timeout de mensagem livre marcava o item otimista como `failed`, embora a entrega pudesse ter ocorrido e não devesse ser repetida automaticamente.
4. A verificação de produção permanece bloqueada por sessão expirada.

## Decisões tomadas

- Não repetir automaticamente envios com resultado ambíguo.
- Tratar timeout como `unknown` até reconciliação pelo histórico.
- Manter a allowlist e o nome técnico autorizado exclusivamente em secrets da Edge.
- Exigir `APPROVED` e `is_active` no registro da organização e WABA antes do teste.
- Não publicar frontend, alterar secrets, executar migrations ou enviar mensagens sem checkpoint.
- Não iniciar a Fase 2 antes da aprovação integral da Fase 1.

## Tarefas concluídas

- Instrumentação e sanitização dos fluxos WhatsApp.
- Proteção server-side da homologação de template.
- Timeout de 12 segundos e idempotência obrigatória para template.
- Estabilização local dos campos de template.
- Renovação preventiva de sessão adicionada localmente.
- Estado `unknown` aplicado localmente a timeout de mensagem livre.

## Tarefas pendentes

- Entrar novamente no CRM com o administrador autorizado.
- Executar somente `get_template_test_access` e confirmar todos os indicadores.
- Confirmar nome, idioma, BODY, `parameter_format`, status e ordem das variáveis do template sincronizado.
- Preparar e solicitar aprovação para publicar o frontend de homologação.
- Validar o frontend publicado em desktop e mobile sem enviar.
- Solicitar aprovação separada para uma mensagem livre real.
- Solicitar aprovação separada para um único template real.
- Confirmar atualização do histórico e status reais sem duplicidade.

## Testes executados

- `node scripts/test-whatsapp-contextual-templates.mjs`
- `node scripts/test-whatsapp-stability.mjs`
- `node scripts/test-whatsapp-templates.mjs`
- `node scripts/test-whatsapp-incremental.mjs`
- `npm run lint`
- `npm run build`
- Validação manual local de digitação, colagem, seleção, Backspace, Delete, Tab, preview e preservação de valores.

## Riscos

- O contrato real do MugoZap para múltiplos parâmetros ainda precisa ser confirmado sem envio pela resposta sincronizada e, depois, por uma tentativa explicitamente aprovada.
- Status `delivered`, `read` e `failed` dependem dos dados retornados pelo MugoZap e ainda precisam de validação real.
- A Edge v35 está publicada, mas a operação restrita ainda não foi exercitada por uma sessão válida.
- O frontend local contém alterações não publicadas e não deve ser confundido com o ambiente produtivo.

## Próximo checkpoint

Checkpoint obrigatório: sessão administrativa autenticada no CRM. Depois do login, executar somente `get_template_test_access`. Se qualquer indicador for falso, interromper. Se todos forem verdadeiros, apresentar o resultado e solicitar aprovação para o deploy do frontend.

## Rollback

- Edge: republicar a versão anterior do arquivo `supabase/functions/mugozap-api/index.ts` correspondente ao commit `0f08a86`; isso exige aprovação de deploy.
- Frontend: manter `VITE_WHATSAPP_TEMPLATE_SEND_ENABLED=false` e desativar `VITE_WHATSAPP_TEMPLATE_TEST_ENABLED`.
- Não remover `sync_templates`, não alterar banco e não apagar registros de auditoria.
