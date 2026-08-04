import { useEffect, useMemo, useState } from "react";
import { listExpenseInstallments } from "../services/data/expensesRepository";
import { PageHeader } from "./PageHeader";

const money = (value) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value || 0);
const currentMonth = new Date().toISOString().slice(0, 7);
const today = new Date().toISOString().slice(0, 10);
const nextMonth = new Date(Date.now() + 30 * 86400000)
  .toISOString()
  .slice(0, 10);
const balance = (row, paidField = "received_amount") =>
  Math.max(Number(row.amount || 0) - Number(row[paidField] || 0), 0);

function Stat({ label, value }) {
  return (
    <article className="business-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

export function Dashboard({
  contracts = [],
  installments = [],
  clients = [],
  alerts = [],
}) {
  const [payables, setPayables] = useState([]);
  useEffect(() => {
    listExpenseInstallments()
      .then(setPayables)
      .catch(() => setPayables([]));
  }, []);
  const metrics = useMemo(() => {
    const uniqueIncome = [
      ...new Map(installments.map((row) => [row.id, row])).values(),
    ];
    const uniquePayables = [
      ...new Map(payables.map((row) => [row.id, row])).values(),
    ].filter(
      (row) =>
        row.status !== "cancelled" && row.expenses?.scope !== "pending_review",
    );
    const monthIncome = uniqueIncome.filter((row) =>
      String(row.reference_month || row.due_date).startsWith(currentMonth),
    );
    const monthPayables = uniquePayables.filter((row) =>
      String(row.reference_month || row.due_date).startsWith(currentMonth),
    );
    const expected = monthIncome.reduce(
      (sum, row) => sum + Number(row.amount || 0),
      0,
    );
    const received = monthIncome.reduce(
      (sum, row) => sum + Number(row.received_amount || 0),
      0,
    );
    const overdue = uniqueIncome
      .filter(
        (row) =>
          row.status === "overdue" ||
          (row.due_date < today && !["paid", "cancelled"].includes(row.status)),
      )
      .reduce((sum, row) => sum + balance(row), 0);
    const expenses = monthPayables.reduce(
      (sum, row) => sum + Number(row.business_amount || 0),
      0,
    );
    return {
      expected,
      received,
      overdue,
      expenses,
      result: expected - expenses,
      activeClients: clients.filter(
        (row) => row.status === "active" && !row.deleted_at,
      ).length,
      upcomingIncome: uniqueIncome
        .filter(
          (row) =>
            row.due_date >= today &&
            row.due_date <= nextMonth &&
            !["paid", "cancelled"].includes(row.status),
        )
        .sort((a, b) => a.due_date.localeCompare(b.due_date))
        .slice(0, 5),
      upcomingExpenses: uniquePayables
        .filter(
          (row) =>
            row.due_date >= today &&
            row.due_date <= nextMonth &&
            row.status !== "paid",
        )
        .sort((a, b) => a.due_date.localeCompare(b.due_date))
        .slice(0, 5),
      importantAlerts: alerts
        .filter((row) => !["resolved", "dismissed"].includes(row.status))
        .slice(0, 5),
      activeContracts: contracts.filter(
        (row) => row.status === "active" && !row.deleted_at,
      ).length,
    };
  }, [alerts, clients, contracts, installments, payables]);
  return (
    <div className="dashboard-page business-dashboard">
      <PageHeader
        eyebrow="Operação da Mugô"
        title="Dashboard"
        description="Acompanhamento diário do caixa, recebimentos e despesas."
      />
      <section className="dashboard-core-metrics">
        <Stat label="Receita prevista" value={money(metrics.expected)} />
        <Stat label="Receita recebida" value={money(metrics.received)} />
        <Stat label="Receita vencida" value={money(metrics.overdue)} />
        <Stat label="Contas a pagar" value={money(metrics.expenses)} />
        <Stat label="Resultado operacional" value={money(metrics.result)} />
        <Stat label="Clientes ativos" value={metrics.activeClients} />
      </section>
      <section className="dashboard-daily-grid">
        <DailyList
          title="Próximos recebimentos"
          rows={metrics.upcomingIncome}
          empty="Nenhum recebimento previsto para os próximos 30 dias. Cadastre parcelas nos contratos ativos."
          label={(row) =>
            row.clients?.company_name || row.description || "Recebimento"
          }
          value={(row) => money(balance(row))}
        />
        <DailyList
          title="Próximas despesas"
          rows={metrics.upcomingExpenses}
          empty="Nenhuma despesa prevista para os próximos 30 dias. Cadastre pela tela Contas a pagar."
          label={(row) => row.expenses?.name || "Despesa"}
          value={(row) => money(balance(row, "paid_amount"))}
        />
        <DailyList
          title="Alertas importantes"
          rows={metrics.importantAlerts}
          empty="Nenhum alerta importante no momento."
          label={(row) => row.title || row.label || "Alerta"}
          value={(row) => row.priority || row.severity || "Atenção"}
        />
      </section>
    </div>
  );
}

function DailyList({ title, rows, empty, label, value }) {
  return (
    <section className="dashboard-panel dashboard-daily-list">
      <h2>{title}</h2>
      {rows.length ? (
        rows.map((row) => (
          <article key={row.id}>
            <div>
              <strong>{label(row)}</strong>
              <small>
                {row.due_date || row.created_at?.slice(0, 10) || ""}
              </small>
            </div>
            <span>{value(row)}</span>
          </article>
        ))
      ) : (
        <div className="compact-empty-state">{empty}</div>
      )}
    </section>
  );
}
