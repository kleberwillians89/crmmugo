# Sprint 14 — Checklist operacional

Preencher `Resultado obtido`, `Status` (`Pendente`, `Aprovado`, `Falhou`) e `Observação` durante a homologação. Não usar registros financeiros reais em testes destrutivos.

| Área | Ação | Resultado esperado | Resultado obtido | Status | Observação |
|---|---|---|---|---|---|
| Login | Entrar com usuário ativo | Dashboard abre sem erro 401 e sem flicker |  | Pendente |  |
| Login | Sair e voltar por URL autenticada | Sessão e caches são removidos; Login é exibido |  | Pendente |  |
| Dashboard | Conferir KPIs após recebimento | Valores atualizam sem recarregar manualmente |  | Pendente |  |
| Propostas | Buscar com e sem acentos | Mesmos registros são encontrados |  | Pendente |  |
| Propostas | Clicar duas vezes em converter | Um único contrato é criado |  | Pendente |  |
| Propostas | Vincular e desvincular contrato | Relação, badge e timeline atualizam |  | Pendente |  |
| Propostas | Arquivar e restaurar | Registro muda de lista sem permanecer em KPIs |  | Pendente |  |
| Clientes | Cadastrar CNPJ/CPF formatado | Documento é persistido normalizado |  | Pendente |  |
| Clientes | Cadastrar possível duplicado | Confirmação informa candidatos; nada é mesclado |  | Pendente |  |
| Clientes | Abrir registros relacionados | Propostas, contratos, serviços, parcelas e documentos pertencem ao cliente |  | Pendente |  |
| Contratos | Editar valores, datas e responsável | Dados persistem depois de fechar e reabrir |  | Pendente |  |
| Contratos | Gerar cobranças duas vezes | Segunda execução retorna “Nenhuma competência pendente” |  | Pendente |  |
| Contratos | Gerar histórico | Somente competências ausentes são criadas; vencidas ficam overdue |  | Pendente |  |
| Contratos | Cancelar | Status, parcelas abertas, timeline e KPIs atualizam |  | Pendente |  |
| Contratos | Renovar | Vigência, timeline e KPIs atualizam |  | Pendente |  |
| Contratos | Arquivar/restaurar/excluir | Permissões, confirmações e bloqueios financeiros são respeitados |  | Pendente |  |
| Serviços | Editar três responsáveis | Alteração persiste e aparece sem reload |  | Pendente |  |
| Serviços | Conferir rateio | Soma das alocações é exatamente o valor da parcela |  | Pendente |  |
| Financeiro | Confirmar pagamento parcial | Saldo, status partial, Dashboard e cliente atualizam |  | Pendente |  |
| Financeiro | Confirmar pagamento integral | Parcela fica paga e sai de A receber |  | Pendente |  |
| Financeiro | Conferir setup | Setup não é contado como mensalidade nem duplicado |  | Pendente |  |
| Financeiro | Conferir canceladas | Parcelas canceladas não entram no saldo |  | Pendente |  |
| Intelligence | Perguntar sobre receita e vencimentos | Resposta usa parcelas atuais e informa fontes |  | Pendente |  |
| Importação | Importar documento válido | Loading bloqueia clique duplo e registros persistem uma vez |  | Pendente |  |
| Importação | Forçar falha | Erro e etapa são exibidos; arquivo temporário pode ser cancelado |  | Pendente |  |
| Equipe | Editar e desativar integrante | Selects e telas refletem somente estado atual |  | Pendente |  |
| Lixeira | Restaurar proposta e contrato | Registros voltam às listas corretas |  | Pendente |  |
| Desktop 1440 | Percorrer todas as páginas | Sem corte, sobreposição ou espaço inutilizado crítico |  | Pendente |  |
| Desktop 1280 | Percorrer todas as páginas | Tabelas, cards e drawers permanecem legíveis |  | Pendente |  |
| Tablet 1024/768 | Abrir filtros, drawers e modais | Grids reorganizam sem overflow da página |  | Pendente |  |
| Mobile 430/390/375 | Executar fluxos críticos | Uma coluna, ações visíveis e safe area respeitada |  | Pendente |  |
| Teclado | Navegar e fechar dialogs com Escape | Foco visível e ordem compreensível |  | Pendente |  |
| Rede | Simular offline/erro Supabase | Mensagem amigável e detalhes técnicos disponíveis |  | Pendente |  |

