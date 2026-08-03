# Checklist de aplicação — CRM V2 despesas

## Antes

- [ ] Confirmar nome, URL e reference ID do projeto Supabase correto.
- [ ] Confirmar que não é produção equivocada nem outro banco.
- [ ] Confirmar backup recente e testável.
- [ ] Confirmar branch Git e commit/revisão exata da migration.
- [ ] Conferir migrations já aplicadas e a ordem cronológica.
- [ ] Confirmar ambiente e janela de manutenção.
- [ ] Revisar integralmente `202608030001_crm_v2_expense_management.sql`.
- [ ] Confirmar existência de `current_organization_id`, `is_active_user`, `can_write`, `set_updated_at` e `capture_audit_log`.
- [ ] Confirmar que as cinco tabelas ainda não existem; se alguma existir, parar e comparar schemas.
- [ ] Confirmar que o SQL não contém carga de despesas nem alterações em clientes, contratos ou recebíveis.

## Aplicação

- [ ] Abrir o SQL Editor no projeto confirmado.
- [ ] Executar a migration completa em uma única operação.
- [ ] Registrar data, horário, operador e ambiente.
- [ ] Salvar o resultado integral da execução.
- [ ] Confirmar ausência de erro, warning inesperado ou objeto parcialmente criado.
- [ ] Não executar inserts de contas sugeridas.

## Depois

- [ ] Executar `supabase/validation/202608030001_crm_v2_expense_validation.sql`.
- [ ] Confirmar que todos os checks estruturais retornam `ok`.
- [ ] Testar sessão admin da organização A.
- [ ] Testar sessão manager da organização A.
- [ ] Testar sessão viewer da organização A.
- [ ] Testar usuário da organização B e confirmar isolamento.
- [ ] Criar categoria temporária de teste na própria organização.
- [ ] Criar centro de custo temporário.
- [ ] Criar conta financeira temporária.
- [ ] Criar despesa de teste sem dados pessoais.
- [ ] Gerar parcelas e conferir competência, vencimento e centavos.
- [ ] Repetir a geração e confirmar retorno zero/mesma contagem.
- [ ] Arquivar a despesa e confirmar ausência nas queries padrão.
- [ ] Testar rateio compartilhado e arredondamento.
- [ ] Confirmar que despesa pessoal produz `business_amount=0`.
- [ ] Confirmar que `pending_review` produz zero e não entra no resultado empresarial.
- [ ] Confirmar que DELETE físico falha para admin, manager e viewer.
- [ ] Remover dados de teste somente por procedimento aprovado; preferir arquivamento.

## Rollback

- [ ] Interromper uso das novas telas e registrar o incidente.
- [ ] Não executar `DROP ... CASCADE`.
- [ ] Não apagar tabelas se houver qualquer dado.
- [ ] Revogar temporariamente `EXECUTE` da função geradora se necessário.
- [ ] Preservar dados e corrigir por uma migration aditiva posterior.
- [ ] Restaurar backup apenas como último recurso, com aprovação e análise de impacto.
- [ ] Se a migration falhou atomicamente e nenhum objeto/dado persistiu, documentar o erro e corrigir antes de nova tentativa.

Limite: PostgreSQL não oferece rollback transparente depois que uma transação já foi confirmada e passou a receber dados. Por isso, o caminho seguro é correção aditiva, não exclusão dos objetos.
