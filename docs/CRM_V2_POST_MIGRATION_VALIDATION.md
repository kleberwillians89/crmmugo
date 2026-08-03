# CRM V2 — relatório pós-migration

Data: 03/08/2026

## Estado da validação

O usuário confirmou que `202608030001_crm_v2_expense_management.sql` foi aplicada manualmente. O workspace está vinculado a um projeto Supabase, porém não possui `SUPABASE_ACCESS_TOKEN`, senha do banco ou configuração pública Supabase utilizável pelo processo atual. Por segurança, nenhum resultado remoto foi presumido.

O SQL somente leitura `supabase/validation/202608030001_crm_v2_expense_validation.sql` permanece a evidência canônica para catálogo e integridade. Ele deve ser executado no SQL Editor e seu resultado arquivado. A importação financeira fica bloqueada na interface quando as tabelas ou a coluna de controle não estão acessíveis à sessão autenticada.

## Validação estática concluída

- cinco tabelas esperadas na migration;
- RLS habilitado para todas;
- policies separadas de SELECT, INSERT e UPDATE;
- ausência deliberada de policy DELETE;
- isolamento por `current_organization_id()`;
- escrita por `can_write()`;
- FKs compostas por organização;
- índices de organização, status, vencimento, despesa, soft delete e idempotência;
- triggers de `updated_at`, auditoria e rateio;
- função geradora com `SECURITY DEFINER`, `search_path` fixo, autenticação e tenant;
- rateio recalculado pelo banco;
- proteção contra parcelas duplicadas.

## Validação remota pendente

Ainda requer resultado real do SQL Editor:

- tabelas e colunas efetivamente encontradas;
- policies e expressões efetivamente instaladas;
- índices, funções e triggers no catálogo remoto;
- contagens de inconsistências;
- testes com sessões admin, manager, viewer e segunda organização.

Não avançar com importações até todos os checks críticos retornarem `ok`.

## Migration adicional da Fase 3

Foi preparada `202608030002_financial_import_control.sql`. Ela adiciona `expenses.import_key` e índice único parcial por organização. Não contém inserts nem updates. Essa chave é necessária para idempotência forte do importador e deve ser aplicada e validada manualmente antes do uso.

## Riscos

- A confirmação verbal de aplicação não substitui o resultado do catálogo remoto.
- A migration local revisada deve ser comparada com o SQL efetivamente aplicado para evitar drift.
- Sem a migration de controle, a importação permanece bloqueada.
- Dados mestres e contas só são criados após confirmação explícita na interface.
