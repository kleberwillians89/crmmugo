# Frente A — Financeiro (28/10/2026)

Branch: stabilization/finance-20261028. Nenhuma alteração remota ou migration.

## Causa comprovada

O catálogo do projeto crm_mugo contém simultaneamente:
- Constraint UNIQUE(organization_id,contract_id,reference_month,installment_number).
- Índice único invoice_installments_contract_type_competence_unique em
  (organization_id,contract_id,installment_type,reference_month).

O segundo não aparece em pg_constraint, pois é índice único independente.
Isso explica a aparente divergência. Não houve prova de que o frontend usa outro
projeto: a URL real do formulário ainda precisa ser confirmada. O CLI/conector
apontam para hdyjuyhiybjqvxsukmbn; o formulário usa a configuração VITE em runtime.
Não há ID da tentativa/parcela para atribuir o incidente a um registro específico.

Mudar o número não evita conflito de mesma mensalidade por competência. O insert
propagava o erro bruto, sem localizar o registro. O formulário oferecia tipos
project/other que a CHECK efetiva rejeita (só setup/monthly). Para setup sem mês,
enviava o vencimento inteiro como competência, enquanto o gerador de contratos
usa o primeiro dia do mês: a serialização foi alinhada, sem mudar vencimento.

## Correção mínima

- Busca tenant-scoped da parcela conflitante antes do insert e após 23505.
- Erro legível com registro existente; botão Ver parcela existente consulta a lista
  novamente e abre o drawer atual. Nenhum update é feito no registro encontrado.
- Exclusão de project/other apenas do cadastro novo; natureza Extra segue disponível.
- Competência YYYY-MM-01; contrato, valor, número e vencimento preservados.
- Ref síncrona no submit e promessa compartilhada para requisições idênticas no
  mesmo runtime. Corridas entre runtimes continuam protegidas pelos dois índices.
- Nenhum resultado duplicado é tratado como autorização para confirmar pagamento.
  Se o cadastro ocorreu mas o recebimento falhou, o retry mostra o registro para
  revisão; nunca sobrescreve valor recebido nem confirma um recebimento às cegas.

Arquivos: src/services/data/financeRepository.js,
src/components/InstallmentFormModal.jsx, src/components/FinancePage.jsx,
tests/installment-creation-conflict.test.mjs e
tests/installment-creation-postgres.test.mjs e scripts/test-revenue-distribution.mjs.
A asserção do formulário foi alinhada à CHECK real; os testes de classificação
e distribuição de registros históricos project/other foram mantidos.

Os testes novos reproduziram falhas antes da implementação. Usam somente fixtures
sintéticas; PostgreSQL local privado testa dois runtimes independentes, um insert
vencedor e um conflito legível, ambas as regras de unicidade, leitura RLS entre
tenants e preservação do valor e recebimento existentes. Um setup com número
não conflitante continua válido. As políticas RLS da fixture financeira não são
um snapshot de todas as políticas remotas: validação local, não certificação da
configuração publicada. Não foi feito teste visual autenticado do formulário real.

## Riscos, rollback e aceite

O índice atual também bloqueia parcelas pagas/canceladas; essa regra foi preservada.
Criar múltiplas entradas extraordinárias do mesmo tipo/mês exige decisão de negócio
sobre os índices, fora deste hotfix. Não excluir índices nem renumerar registros.

Rollback: reverter apenas o commit desta frente e republicar o frontend anterior,
se previamente autorizado. Não há schema novo, exclusão nem rollback de dados.
Uma parcela já criada deve permanecer, com histórico e pagamento preservados.

Publicação futura: frontend apenas, após validar URL/projeto do build e o painel
em homologação autenticada. Não publicar Edge Functions por esta frente.

Parecer: APTO para homologação local; NÃO APTO para produção até confirmar o
projeto do formulário real e a aceitação visual do cadastro/conflito, com evidência
de uma parcela válida e nenhuma duplicata. Os logs locais estão em
/private/tmp/mugo-finance-{before,regression,postgres,build}.log.

Validação final: 473 testes de aplicação, 1 teste PostgreSQL de corrida/constraints,
24 scripts de regressão e build passaram. Nenhum skip de banco no teste específico.
