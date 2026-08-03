# Auditoria real e preparação assistida — CRM Mugô

Data de preparação: 03/08/2026  
Organização: `1dc27d95-d4c0-447f-a8e8-f0afb6a9f40f`  
Estado: **somente leitura; nenhuma consolidação ou correção executada**.

## Resumo executivo

O snapshot identifica três consolidações altamente prováveis: Amalie, Origami e Roove. Gabi/GIMPORTS exige decisão empresarial. Curavino representa mudança contratual prospectiva, não duplicidade. Santo Circuito permanece sem contrato porque valor, vencimento e status ainda não foram definidos.

Os IDs e valores abaixo são referências para preview. O snapshot não contém a relação integral das parcelas; por isso, quantidades e IDs de parcelas afetadas devem ser obtidos na rota `/administracao/duplicidades-clientes`, pela sessão autenticada e RLS, antes de qualquer confirmação.

## Consolidações altamente prováveis

### Amalie

- Principal: `5e1646d2-6163-4164-9772-2acf31731eac` — AMALIE CONFECÇÕES LTDA.
- Secundário: `c68ebe35-e064-4fa1-9160-98725063c920` — Amalie.
- Contrato: `31978937-d01e-4aa6-925a-04e1901aafe7`.
- Valor informado: R$ 4.000,00/mês; vencimento dia 20.
- Ação recomendada: preservar o principal e preparar a movimentação auditada dos vínculos do secundário.
- Parcelas: listar somente as futuras que passariam do dia 15 para o dia 20; não alterar passado ou pagamentos.
- Risco: setup vencido de R$ 4.000,00 deve permanecer separado da mensalidade e sob revisão.

### Origami

- Principal: `61974c0b-e344-4d60-9b12-1a1680c9c270` — ORIGAMI CONSULTORIA DE INVESTIMENTOS LTDA.
- Secundário: `cf6d93db-1fa4-4fd9-9c3f-f8f1d1969611` — Origami Investimentos.
- Contrato: `1d50e5d9-847e-4c96-9075-6a295b34b19f`.
- Valor preservado: R$ 1.500,00/mês; vencimento dia 7.
- Ação recomendada: consolidar no cadastro empresarial, preservando telefone do secundário, contrato, proposta, parcelas, pagamentos e histórico.
- Risco: nenhum valor financeiro deve ser recalculado durante a consolidação cadastral.

### Roove

- Principal: `e7919cd3-c989-49c9-994f-eb31aa9ce294` — ROOVE COMÉRCIO DE VESTUÁRIO E ACESSÓRIOS LTDA.
- Secundário: `078a840a-5363-4a33-b6fe-646c1a5b851c` — ROOVE / ROOVER.
- Contrato: `3b56bcde-99b5-4244-9a5d-e0535339a59f`.
- Atual: R$ 2.300,00/mês; vencimento dia 10.
- Informado: R$ 3.200,00/mês; vencimento dia 20.
- Ação recomendada: consolidar cadastro separadamente da mudança contratual e preservar o telefone `5511993161161`.
- Bloqueio: definir a competência inicial do novo valor.
- Parcelas: mostrar apenas futuras; qualquer evidência em `paid_at`, `received_amount` ou campo equivalente exige preservação, mesmo com status incoerente.
- Risco: parcelas futuras já marcadas como pagas e alteração retroativa acidental.

## Decisões pendentes

### Gabi / GIMPORTS

- Candidatos: `744dd494-5eed-4429-b432-9c8f407be37c` e `de129d57-976f-42b6-a0a2-bafe7d16df13`.
- Contrato: `71dd1456-0dd9-4b69-b77c-030b6269b24c`.
- Atual: R$ 3.500,00/mês, dia 20; setup R$ 4.000,00.
- Informado: R$ 5.000,00/mês; vencimento pendente.
- Decisão necessária: (A) GIMPORTS cliente e Gabriela contato; (B) consolidar; ou (C) manter entidades separadas.
- Bloqueio: não atualizar contrato enquanto o vencimento e a natureza jurídica/comercial não forem confirmados. Setup pago é imutável neste fluxo.

### Curavino — mudança contratual

- Cliente: `35b06647-a6e2-4c8d-803a-f394ea890d4f`.
- Contrato antigo: `7585f922-a937-4d2e-8a85-9846f3a93334` — R$ 1.000,00/mês, dia 15, término em 26/07/2026.
- Novo dado: R$ 1.500,00/mês, dia 7.
- Ação recomendada: encerrar o contrato antigo corretamente e, somente após definir a data inicial, preparar novo contrato e novas parcelas.
- Risco: reescrita retroativa do contrato antigo ou duplicação de competências.

### Santo Circuito

- Cliente: `6a25e024-0781-4cf1-a225-cd739bf34ef4` — CAFIFA/SANTO CIRCUITO.
- Valor, vencimento e status: indefinidos.
- Ação recomendada: manter em definição; não criar contrato nem parcelas.

## Regras para parcelas e impacto financeiro

- Identificar repetição prioritariamente por `idempotency_key`, complementada por cliente, contrato, competência, vencimento, valor e número da parcela.
- Nunca inferir remoção por valor igual.
- Preservar parcelas pagas, `paid_at`, valores recebidos e histórico.
- Setup e mensalidade iguais não formam duplicidade automaticamente.
- Exibir receita confirmada separada da receita sob revisão.
- O impacto potencial conhecido, sem contar parcelas, é: Amalie com setup vencido de R$ 4.000,00 sob revisão; Roove com diferença prospectiva de R$ 900,00 por mês; Gabi com diferença prospectiva de R$ 1.500,00 por mês; Curavino com diferença prospectiva de R$ 500,00 por mês. Esses valores não autorizam atualização nem devem ser aplicados retroativamente.

## Fluxo recomendado

1. Gerar preview RPC somente leitura para Amalie, Origami e Roove.
2. Conferir organização, contagens por tabela, parcelas futuras e evidências de pagamento.
3. Resolver Gabi e datas iniciais de Roove/Curavino fora do fluxo automático.
4. Produzir novo snapshot `before` imediatamente antes de qualquer operação futura.
5. Em etapa posterior e com autorização específica, exigir confirmação forte, transação única, idempotência, auditoria `before/after` e rollback integral.

## Garantias desta etapa

- Nenhum merge ou update foi executado.
- Nenhum cliente foi arquivado ou excluído.
- Nenhum contrato ou parcela foi criado, alterado ou removido.
- Nenhum vínculo WhatsApp foi alterado.
- Nenhuma parcela foi regenerada.
- Nenhum deploy foi realizado.
