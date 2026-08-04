const number = (value) => Number(value || 0);
const monthKey = (value) => String(value || "").slice(0, 7);

export function uniqueById(rows = []) {
  return [
    ...new Map(
      rows.filter((row) => row?.id).map((row) => [row.id, row]),
    ).values(),
  ];
}

export function financialDashboard(receivables = [], payables = [], period) {
  const income = uniqueById(receivables).filter(
    (row) => monthKey(row.reference_month || row.due_date) === period,
  );
  const expenses = uniqueById(payables).filter(
    (row) =>
      monthKey(row.reference_month || row.due_date) === period &&
      row.status !== "cancelled" &&
      row.expenses?.scope !== "pending_review",
  );
  const revenue = income.reduce((sum, row) => sum + number(row.amount), 0);
  const received = income.reduce(
    (sum, row) => sum + number(row.received_amount),
    0,
  );
  const expense = expenses.reduce(
    (sum, row) => sum + number(row.business_amount),
    0,
  );
  const paidExpense = expenses.reduce(
    (sum, row) =>
      sum +
      Math.min(
        number(row.paid_amount),
        number(row.business_amount || row.amount),
      ),
    0,
  );
  return {
    income,
    expenses,
    revenue,
    received,
    receivable: Math.max(revenue - received, 0),
    expense,
    paidExpense,
    payable: Math.max(expense - paidExpense, 0),
    cashFlow: received - paidExpense,
    operatingResult: revenue - expense,
  };
}

const escapeCsv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;

export function accountingCsv(receivables = [], payables = [], period) {
  const dashboard = financialDashboard(receivables, payables, period);
  const rows = [
    [
      "Competência",
      "Tipo",
      "Descrição",
      "Contraparte",
      "Vencimento",
      "Valor",
      "Pago/Recebido",
      "Status",
      "Categoria",
      "Centro de custo",
      "Conta financeira",
    ],
    ...dashboard.income.map((row) => [
      row.reference_month,
      "Receita",
      row.description || "Mensalidade",
      row.clients?.company_name || "Cliente não informado",
      row.due_date,
      number(row.amount).toFixed(2),
      number(row.received_amount).toFixed(2),
      row.status,
      row.installment_type || "monthly",
      "",
      row.provider || "",
    ]),
    ...dashboard.expenses.map((row) => [
      row.reference_month,
      "Despesa",
      row.expenses?.name || "Conta a pagar",
      row.expenses?.supplier_name || "Fornecedor não informado",
      row.due_date,
      number(row.business_amount).toFixed(2),
      number(row.paid_amount).toFixed(2),
      row.status,
      row.expenses?.expense_categories?.name || "",
      row.expenses?.cost_centers?.name || "",
      row.expenses?.financial_accounts?.name || "",
    ]),
  ];
  return `\ufeffsep=;\n${rows.map((row) => row.map(escapeCsv).join(";")).join("\n")}`;
}
