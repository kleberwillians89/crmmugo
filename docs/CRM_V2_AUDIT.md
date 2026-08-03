# Auditoria estrutural — CRM Mugô V2

Data: 03/08/2026  
Escopo: auditoria estática do frontend React/Vite, camada de dados e migrations Supabase. Nenhuma consulta ou alteração foi feita na base remota.

## Resumo executivo

O CRM já possui uma base comercial madura: clientes, propostas, contratos, serviços contratados, recebíveis, pagamentos, documentos, equipe, responsabilidades, auditoria, inteligência, alertas e WhatsApp são entidades existentes e devem ser preservadas. A principal dívida é de arquitetura da informação: `App.jsx` concentra roteamento, carregamento global e composição de páginas; o Sidebar expõe apenas parte das páginas existentes; e “Financeiro” reúne recebíveis em uma única tela sem um domínio de contas a pagar.

A V2 deve ser aditiva. Não é necessário recriar clientes, contratos, serviços ou contas a receber. São necessárias cinco tabelas novas para o domínio de despesas: `expense_categories`, `cost_centers`, `financial_accounts`, `expenses` e `expense_installments`.

## Arquitetura atual

- React 19 + Vite + JavaScript, sem biblioteca de rotas. `App.jsx` resolve `window.location.pathname`, guarda a página ativa e renderiza componentes por condicionais.
- `AuthContext` carrega `profiles`, expõe `canWrite` para `admin/manager` e `isAdmin` para `admin`.
- A camada `src/services/data` encapsula Supabase. RLS é a barreira definitiva de isolamento; repositories normalmente obtêm `organization_id` via `organizationId()` e as tabelas usam `current_organization_id()`.
- `CRM_DATA_CHANGED` invalida dados comerciais e financeiros após mutações.
- O provider legado continua disponível; funcionalidades estruturadas são condicionadas ao Supabase.
- `App.jsx` carrega propostas, contratos, clientes, recebíveis, inteligência e equipe na inicialização, mesmo quando a página aberta não precisa de todo esse conjunto.
- Estilos globais residem principalmente em `App.css`, com CSS específico de operações e WhatsApp.

## Páginas e rotas

Rotas públicas no mapa atual: `/`, `/propostas`, `/contratos`, `/clientes`, `/financeiro`, `/whatsapp`, `/servicos`, `/documentos`, `/configuracoes` e oito rotas `/intelligence/*`. `/importar` é alias de documentos.

Páginas renderizáveis sem rota canônica no mapa: nova proposta, equipe, reconciliação financeira, diagnóstico, lixeira, integridade, auditoria, saúde, backup, restauração e performance. Isso explica links internos que mudam o estado sem URL estável e páginas difíceis de descobrir.

Compatibilidade obrigatória: `/financeiro` deve continuar abrindo o fluxo financeiro existente; rotas antigas não serão removidas. Novas rotas terão aliases explícitos no mapa central.

## Sidebar atual e problemas de navegação

O Sidebar atual tem quatro grupos: Operação, Comunicação, Gestão e Configuração. Ele oferece Painel, Clientes, Propostas, Contratos, Financeiro, WhatsApp, Hoje, Atenção, Insights, Serviços, Documentos e Configurações.

Problemas encontrados:

- páginas existentes como Equipe, Reconciliação, Auditoria, Backup, Restauração, Diagnóstico, Saúde, Integridade e Lixeira não aparecem;
- tendências, recomendações, análise cruzada e IA possuem rota, mas não aparecem no menu;
- serviços estão em Configuração, embora sejam parte do domínio comercial;
- grupos não podem ser recolhidos individualmente;
- o agrupamento mistura operação, administração e inteligência;
- `App.jsx` e `Sidebar.jsx` mantêm definições de navegação separadas.

## Queries, repositories e permissões

- `clientsRepository`: leitura detalhada de cliente e relações; criação/edição; arquivamento/reativação; prevenção de duplicidades no frontend.
- `proposalsRepository`: CRUD, serviços da proposta, eventos e arquivamento; pode resolver/criar cliente com confirmação contra possíveis duplicidades.
- `contractsRepository`: CRUD, cancelamento, renovação, arquivamento/restauração, geração de cobranças e exclusão permanente administrativa.
- `financeRepository`: recebíveis, alocações por serviço, criação/edição de parcelas e confirmação de recebimento via RPC.
- `teamRepository` e `serviceResponsibilitiesRepository`: equipe e responsáveis.
- `settingsRepository`: configurações da organização.
- `documentsRepository`: storage privado e metadados; a exclusão atual é física e merece revisão futura, fora desta entrega.
- `operationsRepository`: auditoria, reconciliação, saúde, permissões, backup e restauração.
- `pulseRepository`, `intelligenceRepository`, `tasksRepository`: alertas, inteligência e tarefas.
- repositories de WhatsApp preservam provider, vínculos e automações atuais.

Leitura é permitida a usuário autenticado e ativo dentro da organização. Escrita é permitida a `admin` e `manager`; ações administrativas e exclusões permanentes ficam com `admin`. As novas tabelas devem seguir o mesmo padrão, sempre com `organization_id`, RLS e `WITH CHECK`.

## Sobreposições e reutilização

- `FinancePage` (recebíveis) e `FinancialReconciliationPage` (integridade) são complementares, mas aparecem como conceitos concorrentes por falta de um hub financeiro.
- `Dashboard`, `TodayPage`, `PulseDailySummary` e telas de inteligência repetem sinais de atenção; a V2 deve priorizar ações no Dashboard e manter análise aprofundada em Inteligência.
- `ClientsPage` já contém uma ficha rica (`ClientCenter`) e dados necessários para a ficha premium; deve evoluir sem criar uma segunda entidade de cliente.
- `FinancePage`, `financialMetrics.js`, `contractBilling.js`, `PageHeader`, `PageSkeleton`, `FeedbackMessage`, tabelas e cards existentes são reutilizáveis.
- `SystemAuditPage`, `BackupPage`, `RestorePage`, `SupabaseDiagnosticPage` e `CrmHealthPage` devem apenas ganhar navegação, não ser duplicadas.

## Inventário de dados

Tabelas principais existentes: `organizations`, `profiles`, `organization_settings`, `clients`, `proposals`, `proposal_services`, `contracts`, `contract_services`, `documents`, `invoice_installments`, `invoice_installment_allocations`, `payments`, `payment_events`, `commercial_events`, `team_members`, `crm_tasks`, `audit_log`, tabelas de Pulse, WhatsApp e IA.

Migrations existentes já adicionam contato financeiro de clientes, responsáveis, soft delete, confiabilidade contratual, faturamento, alocação de receita, auditoria e idempotência. Nenhuma migration antiga será editada.

Não foram encontradas tabelas de despesas, contas a pagar, categorias de despesa, centros de custo ou contas bancárias/financeiras. `organization_settings.bank_name` e dados PIX são configuração de cobrança, não um razão de contas financeiras.

## Novas tabelas necessárias

- `expense_categories`: classificação contábil por organização.
- `cost_centers`: dimensão gerencial por organização.
- `financial_accounts`: caixa/banco/cartão usados para pagamento.
- `expenses`: compromisso a pagar, recorrência, escopo empresarial/pessoal/compartilhado e soft delete.
- `expense_installments`: competências e pagamentos; chave idempotente e unicidade por despesa/competência/parcela.

Registros iniciais informados pelo usuário serão apenas sugestões locais na tela de revisão. A migration não contém inserts de despesas e não toca dados reais.

## Riscos e controles

- **Worktree com mudanças locais:** há alterações em WhatsApp, `App.jsx`, `App.css` e outros arquivos. Preservar tudo, aplicar patches mínimos e não formatar arquivos inteiros.
- **Migration ainda não aplicada:** o frontend deve tratar ausência das tabelas com mensagem clara; aplicação no Supabase é manual.
- **RLS/tenant:** políticas novas devem comparar `organization_id` com `current_organization_id()` e exigir `can_write()` para mutações.
- **Dados pessoais:** exportações financeiras devem evitar telefone, e-mail e documentos por padrão.
- **Rateio:** `pending_review` e `personal` não entram nos indicadores oficiais; `shared` usa apenas o percentual empresarial.
- **Idempotência:** parcelas usam chave única por organização e índice único parcial para `idempotency_key`.
- **Rotas sem biblioteca:** manter History API e aliases; adicionar teste estático de compatibilidade.
- **Escopo amplo:** entregar fundação funcional segura; integrações Asaas e importação confirmada de dados permanecem futuras.

## Plano de implementação

1. Centralizar rotas e grupos de navegação; adaptar Sidebar com grupos recolhíveis e filtros de permissão.
2. Criar migration aditiva do domínio de despesas com constraints, índices, triggers, RLS e auditoria.
3. Criar métricas financeiras puras e repository de despesas.
4. Criar hub/resumo financeiro, contas a pagar, recorrentes, fluxo de caixa e relatórios; preservar `FinancePage` como contas a receber.
5. Criar revisão não mutante dos clientes/contratos informados.
6. Integrar páginas com mudanças mínimas em `App.jsx`, preservando rotas antigas e WhatsApp.
7. Elevar o CSS responsivo sem alterar a identidade Mugô.
8. Adicionar testes puros/estáticos e executar lint, build e suíte relevante.

## Arquivos planejados

Alterados: `src/App.jsx`, `src/App.css`, `src/components/Sidebar.jsx`, `package.json`.

Novos: `src/config/appRoutes.js`, `src/config/navigationGroups.js`, componentes/layouts financeiros, páginas financeiras, revisão de dados, `src/services/data/expensesRepository.js`, `src/lib/expenseMetrics.js`, testes V2 e uma migration Supabase datada. Este documento também é novo.

## Migration necessária

Uma única migration nova e aditiva, posterior às migrations atuais, criando exclusivamente as cinco tabelas do domínio de despesas, funções/RPCs auxiliares idempotentes, índices, triggers, políticas RLS e auditoria. Não haverá `UPDATE`, `DELETE`, alteração de migration antiga ou carga automática de dados.
