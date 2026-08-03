# Revisão da migration CRM V2 — despesas

Data: 03/08/2026  
Migration: `supabase/migrations/202608030001_crm_v2_expense_management.sql`  
Estado: revisada, não aplicada.

## Resumo

A migration cria cinco tabelas multiempresa: categorias de despesa, centros de custo, contas financeiras, despesas e parcelas. Todos os IDs são UUID, todas as tabelas possuem `organization_id`, valores monetários usam `numeric(14,2)`, percentuais usam `numeric(5,2)` e nenhuma carga de dados está incluída.

As políticas seguem os helpers existentes: `current_organization_id()`, `is_active_user()` e `can_write()`. Usuários ativos leem somente a própria organização; `admin` e `manager` inserem e atualizam; viewer apenas lê. Não existe policy de `DELETE`, portanto a API autenticada não pode excluir fisicamente. O arquivamento de despesas usa `deleted_at`.

## Problemas encontrados e correções

1. **FKs sem garantia de tenant.** Uma despesa poderia referenciar o UUID de categoria, centro ou conta de outra organização. Foram adicionadas chaves únicas `(organization_id,id)` e FKs compostas. A parcela também usa FK composta para a despesa.
2. **Rateio confiado ao cliente.** `business_amount` podia ser informado diretamente. Foi criada a função pura `expense_business_amount` e um trigger `SECURITY INVOKER` que sempre recalcula o valor no banco.
3. **Execução pública implícita.** Funções PostgreSQL recebem `EXECUTE` de `PUBLIC` por padrão. A função `SECURITY DEFINER` agora revoga `PUBLIC` explicitamente e concede apenas a `authenticated`.
4. **Ordem da autorização.** `generate_expense_installments` verifica `auth.uid()` e `can_write()` antes de consultar/bloquear a despesa.
5. **Exclusão física permitida por policy genérica.** A policy `FOR ALL` foi substituída por policies separadas de SELECT, INSERT e UPDATE. Não há DELETE.
6. **Recorrência incompleta.** Parcelamentos exigem início e quantidade positiva; recorrências exigem data inicial. Trimestral, semestral e anual passam a respeitar intervalos próprios.
7. **Índices incompletos.** Foram incluídos índices de `(organization_id,deleted_at)` e `expense_id`, além dos índices de organização/status/vencimento e idempotência.
8. **Validação pendente.** `pending_review` exige percentual zero e `validated=false`.
9. **Mudança de escopo após parcelamento.** Um trigger em `expenses` recalcula as parcelas existentes quando `scope` ou `business_percentage` muda.
10. **Parcelas de despesas arquivadas.** O repository usa relacionamento interno e filtro explícito `expenses.deleted_at is null`.

## Regras financeiras e fonte de verdade

O banco é a fonte de verdade de `business_amount`:

- `business`: 100% de `amount`;
- `personal`: zero;
- `shared`: `round(amount * business_percentage / 100, 2)`;
- `pending_review`: zero.

O trigger executa antes de inserir ou alterar parcela, arredonda valores para duas casas e ignora um `business_amount` arbitrário do frontend. Constraints impedem valores negativos, pagamento maior que a parcela e percentual fora de 0–100. O helper JavaScript espelha a regra apenas para prévia de interface; indicadores persistidos usam o valor calculado no banco.

## Segurança da função de parcelas

`generate_expense_installments(uuid)` é `SECURITY DEFINER` porque precisa executar a geração de forma atômica, mas possui `search_path=''`, nomes de objetos qualificados, autenticação obrigatória, `can_write()`, filtro simultâneo por ID e `current_organization_id()`, `deleted_at is null`, bloqueio `FOR UPDATE`, concessão apenas a `authenticated` e inserção com organização derivada da linha encontrada. A unicidade `(organization_id,expense_id,reference_month,installment_number)` e `ON CONFLICT DO NOTHING` tornam novas execuções idempotentes.

## Auditoria e timestamps

Todas as tabelas recebem o trigger existente `set_updated_at`. Quando `capture_audit_log()` existe, a migration adiciona `audit_changes`. A migration é ordenada depois da criação dessas funções no histórico atual. O bloco condicional evita falha em ambientes parciais, mas a validação pós-aplicação deve exigir os triggers.

## Riscos residuais

- Aplicar fora da ordem histórica pode deixar triggers de auditoria ausentes; o SQL de validação detecta isso.
- `IF NOT EXISTS` não converte uma estrutura parcial antiga. Não há indicação de que as tabelas existam; se existirem no projeto remoto, interromper e comparar schemas antes de aplicar.
- Recorrência sem `end_date` gera somente a primeira parcela. Gerações futuras devem ser feitas por rotina mensal idempotente, ainda não implementada.
- Soft delete existe apenas em `expenses`; cadastros auxiliares usam `active=false`, conforme seu modelo.
- A migration não cria DRE materializado. Indicadores devem excluir `pending_review`, `cancelled` e despesas arquivadas.

## Aplicação

1. Confirmar projeto, ambiente, branch e backup.
2. Verificar que todas as migrations anteriores estão aplicadas, especialmente fundação e auditoria.
3. Abrir a migration no SQL Editor do projeto correto.
4. Executar a migration inteira uma única vez e registrar horário/resultado.
5. Executar `supabase/validation/202608030001_crm_v2_expense_validation.sql`.
6. Testar papéis em sessões reais separadas. Não usar service role nos testes funcionais do frontend.

Nenhuma aplicação automática faz parte desta entrega.

## Rollback seguro

Não executar `DROP TABLE` automaticamente após uso. Se a aplicação falhar antes de qualquer dado ser criado, revisar o erro e, somente com backup confirmado, remover objetos em ordem de dependência: função geradora, trigger/função de rateio, `expense_installments`, `expenses`, `financial_accounts`, `cost_centers`, `expense_categories`.

Se já houver qualquer registro, o rollback recomendado é lógico: desabilitar as rotas no frontend, revogar execução da função geradora e preservar tabelas/dados para correção por nova migration. `DROP ... CASCADE` não é aceitável.

## Consultas e testes pós-aplicação

O arquivo de validação retorna linhas com `check_name`, `status` e `detail`. Todos os checks estruturais e de dados devem retornar `ok`. Depois:

- viewer: SELECT funciona; INSERT/UPDATE/DELETE falham;
- manager: SELECT/INSERT/UPDATE da própria organização funcionam; acesso cruzado e DELETE falham;
- admin: gerencia e arquiva registros da própria organização; acesso cruzado e DELETE físico falham;
- executar geração duas vezes: segunda chamada retorna `0` e não aumenta a contagem;
- criar casos business, personal, shared e pending_review e conferir `business_amount`;
- confirmar que queries padrão usam `expenses.deleted_at is null` e excluem `pending_review` dos indicadores.
