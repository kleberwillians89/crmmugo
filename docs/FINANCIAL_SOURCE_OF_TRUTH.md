# Fonte de verdade financeira

## Hierarquia por contrato e tipo

1. Existindo `invoice_installments` de `installment_type = 'setup'`, setup previsto, recebido e saldo são calculados exclusivamente dessas parcelas.
2. Sem parcela de setup, `contracts.setup_value` e `contracts.setup_received_amount` são fallback legado. O registro é sinalizado para normalização; nenhum recebimento fictício é criado.
3. Existindo parcelas `installment_type = 'monthly'`, mensalidade prevista, recebida e saldo são calculados exclusivamente dessas parcelas.
4. Sem parcelas mensais, `contracts.monthly_value` é uma estimativa temporária. A projeção usa o prazo conhecido (`minimum_term_months`) ou um ciclo quando não há prazo. Ela nunca é somada às parcelas reais do mesmo contrato.
5. `received_amount` representa recebimento confirmado associado à parcela. Campos legados nunca são adicionados quando há parcela correspondente.

## Fórmulas

Para parcela não cancelada:

```text
saldo = max(amount - received_amount, 0)
previsto ativo = amount
recebido confirmado = received_amount
```

Para parcela cancelada:

```text
previsto ativo = 0
saldo em aberto = 0
vencido = 0
futuro = 0
recebido histórico = received_amount confirmado
```

Pagamento parcial soma somente `max(amount - received_amount, 0)` em “A receber”. Valor recebido nunca é contado novamente como saldo.

## Classificação

- A receber: `pending`, `open`, `overdue`, `partial` ou `partially_paid`, somente pelo saldo restante.
- Recebido: `paid` ou `received`, e qualquer `received_amount > 0` confirmado. Cancelamento posterior não apaga o histórico.
- Cancelado: `cancelled`; não entra em previsto ativo, aberto, vencido ou futuro.
- Vencido: não cancelado, saldo positivo e `due_date` anterior à data atual.
- Futuro: não cancelado, saldo positivo e `due_date` igual ou posterior à data atual.

## Invariantes

- Nunca somar parcela de setup + `setup_received_amount` + `setup_value`.
- Nunca somar parcelas mensais + projeção baseada em `monthly_value` no mesmo contrato.
- Setup e mensalidade são agregados separadamente.
- Rateios de serviço devem fechar exatamente com o valor da parcela, inclusive centavos.
- Fallbacks legados são identificados nos resultados por contadores e IDs para futura normalização.
