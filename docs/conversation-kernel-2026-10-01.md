# Evolução conversacional — 2026-10-01

## Antes

- `whatsapp-webhook` autentica o webhook, resolve tenant e membro por telefone e envia eventos internos para `task_command_events`. Externos seguem as filas comerciais/automação conforme configuração e prioridade humana.
- Interno: parser determinístico, sessões de clarificação, planner `internalSecretaryAgent`, canonicalizer, validadores, adapter, executores e checkpoints. Rescues de leitura, escrita e correção já existiam.
- Comercial: classificação por regras antes de criar oportunidade; planner comercial depois. Suporte já possuía handoff, mas a criação dependia da classificação determinística.
- Estado interno em `internal_assistant_sessions`; histórico/qualificação externos em tabelas existentes. Sem contrato compartilhado de entendimento ou revisão estruturada pela interface.

## Agora

Identidade autenticada → contexto com escopo → compreensão semântica → referências verificadas → catálogo autorizado → validação → executor existente → resultado persistido → composição da resposta.

- `conversationKernel.js` centraliza contrato, princípios, normalização de entendimento, memória, referências e trace. Intenções semânticas são nomes abertos; ferramentas continuam fechadas por segurança.
- Os dois planners continuam especializados. O kernel **não** é um agente único com acesso irrestrito aos dois domínios; separar executores impede que texto externo selecione ferramentas internas.
- Interno recebe histórico e memória de 30 minutos por organização/membro/conversa. Mantém até 24 entidades e 12 ações. Referências do modelo apontam para handles conhecidos, resolvidos no servidor, e a mutação consulta o CRM novamente.
- Consulta e ação declaradas no entendimento não podem ser respondidas apenas como texto sem execução. Rescues legados permanecem; não foram ampliados com listas de frases.
- Pendências não financeiras deixam de bloquear automaticamente o planner disponível. Confirmações, seleções inequívocas, arquivos e rescues de segurança permanecem determinísticos.
- Comercial interpreta antes de criar oportunidade. Só `new_business` chega à criação; suporte/financeiro/rotina seguem handoff, descoberta segue conversa sem abrir oportunidade. Há rechecagem da prioridade humana após o modelo.
- Contexto externo usa projeção positiva de campos comerciais, nomes de serviços ativos do próprio cliente e histórico da própria conversa. Não fornece tarefas, equipe, IDs ou notas internas.
- Memória externa fica no trace do último evento comercial concluído; qualificação persistida continua sendo a fonte de longo prazo.
- Reabertura exige tarefa concluída, não arquivada, do tenant correto; a atualização precisa retornar uma linha antes de confirmar sucesso.
- Trace registra identidade, domínio, intenções/confiança/entidades/referências, contexto, caminho, planner, chamadas/resultados, resposta, latência e erros. Não registra chain-of-thought.
- Feedback na conversa registra oito categorias, justificativa, revisor e tenant. RLS e trigger validam conversa/evento; não há treinamento nem alteração automática de prompt.

## Ferramentas internas disponíveis

`search_tasks`, `search_clients`, `reopen_task`, `create_task`, `update_task`, `complete_task`, `start_task`, `list_my_tasks`, `list_team_tasks`, `record_activity`, `record_hours`, `record_decision`, `record_observation`, `register_expense`, `register_receipt`, `list_pending_charges`, `send_collection`, `create_follow_up`, `get_day_summary`, `get_week_summary`, `plan_my_day`, `take_conversation`, `assign_conversation`.

Comercial mantém capacidades dos executores existentes: resolver contato/cliente, consultar contexto e serviços ativos, criar/atualizar oportunidade e qualificação, resumo, follow-up, handoff e resposta. Não recebe ferramentas internas. Financeiro e cobranças mantêm confirmações existentes.

## Arquivos

Produção:

- `supabase/functions/_shared/conversationKernel.js` (novo)
- `supabase/functions/_shared/internalSecretaryAgent.js`
- `supabase/functions/_shared/commercialAgentCore.js`
- `supabase/functions/task-command-worker/index.ts`
- `supabase/functions/commercial-ai-worker/index.ts`
- `supabase/migrations/202610010001_conversation_feedback.sql` (nova; não aplicada remotamente)
- `src/components/ConversationFeedback.jsx` e `.css` (novos)
- `src/components/WhatsAppPage.jsx` (feedback aditivo; header preservado)
- `src/services/data/conversationFeedbackRepository.js` (novo)

Validação/documentação:

- `tests/conversation-kernel.test.mjs` (11 testes novos)
- `tests/conversation-feedback-postgres.test.mjs` (teste PostgreSQL local novo)
- `tests/internal-secretary-agent.test.mjs`
- `tests/commercial-classification-fixes.test.mjs`
- `tests/commercial-support-vs-opportunity.test.mjs`
- `tests/commercial-hub.test.mjs`
- `scripts/eval-conversation-semantics.mjs` (novo)
- este documento.

Assertions estáticas antigas foram ajustadas para verificar classificação antes da criação, handoff no worker e a outbox de equipe realmente utilizada. Não se alterou o webhook para satisfazer testes obsoletos.

## Validação e feedback → regressão

- Suíte `node --test tests/*.test.mjs`: 385 testes passaram, sem skips.
- Todos os 35 comandos `test:*` do package.json passaram.
- Lint: zero erros; dois warnings preexistentes de dependência `loadProposals` em `src/App.jsx`.
- Build passou; warnings preexistentes de chunks/imports permanecem.
- Deno check dos dois workers passou. `git diff --check` passou.
- PostgreSQL temporário valida criação da tabela, RLS, isolamento de tenant, spoofing de revisor, escopo dos eventos e privilégios. Não acessa banco remoto.
- Testes novos cobrem intenção aberta/ferramenta fechada, TTL e escopo, referências, troca de assunto, projeção externa, consulta obrigatória, quatro membros, erro de ferramenta, replay e trace.
- Testes offline com mocks validam **contratos**, não demonstram compreensão do modelo.
- Avaliador semântico tem 17 casos gerados com variações e uma referência de reabertura. Execução real requer `--live`, `OPENAI_API_KEY` e `TASK_COMMAND_MODEL`/`OPENAI_MODEL`. Não executa ferramentas. Não foi executado ao vivo: credenciais/modelo ausentes nesta sessão.
- Para feedback: marcar na conversa → revisar trace e resultado correto → anonimizar → exportar JSON `{id,message,tools,member,session}` → usar `--fixtures caminho.json` no avaliador. Converter falhas de execução em fixtures determinísticas adicionais. A promoção é humana, não automática; a UI ainda não exporta fixtures.

## Limites e próxima homologação

- Não é correto declarar a definição de pronto integralmente atendida sem E2E com modelo e WhatsApp reais. Avaliar qualidade, ambiguidades, custo e latência antes de ativar.
- Adicionar participante a uma reunião não está implementado: o modelo é instruído a não trocar responsável nem alegar que adicionou alguém. Multiassignee legado permanece, mas não equivale a participantes compartilhados.
- Busca de tarefas é por título/filtros (20 resultados); busca de clientes é por razão social (10 resultados). Não há busca vetorial nem loop arbitrário de ferramentas dependentes dentro do mesmo turno. Ambiguidade exige clarificação.
- Serviços/preços continuam sujeitos às fontes e políticas existentes. Projeção de dados reduz exposição; não garante que um LLM jamais alucine. Requer avaliação adversarial de respostas e catálogo comercial autorizado.
- Até seis ações por mensagem e TTL de 30 minutos permanecem limites explícitos. Não implementa undo genérico de operações financeiras.
- Concorrência entre mensagens e entrega externa conservam as garantias/limitações das filas existentes; não se promete exactly-once de rede.
- A interface de feedback depende da nova migration; aplicar em ambiente de validação antes de disponibilizar a interface em produção. Sem essa tabela, salvar avaliação retorna erro visível, sem afetar envio/recepção.
- Nenhum deploy, push, alteração de secrets, ativação comercial ou migration remota foi feito. `ai_mode` não foi alterado. Arquivo preexistente `supabase/.temp/cli-latest` foi preservado.
