import { useEffect, useMemo, useState } from "react";
import { Download, Plus } from "lucide-react";
import { accountingCsv, financialDashboard } from "../lib/financialProduction";
import { listContracts } from "../services/data/contractsRepository";
import {
  createFinancialLookup,
  listExpenseInstallments,
  listExpenseLookups,
  listExpenses,
} from "../services/data/expensesRepository";
import { listInstallments } from "../services/data/financeRepository";
import { useAuth } from "../contexts/AuthContext";
import { FeedbackMessage } from "./FeedbackMessage";
import { PageHeader } from "./PageHeader";

const money = (value) =>
  Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
const currentPeriod = () => new Date().toISOString().slice(0, 7);

function useProductionFinance() {
  const [state, setState] = useState({
    receivables: [],
    payables: [],
    contracts: [],
    loading: true,
    error: "",
  });
  useEffect(() => {
    Promise.all([
      listInstallments(),
      listExpenseInstallments(),
      listContracts(),
    ])
      .then(([receivables, payables, contracts]) =>
        setState({
          receivables,
          payables,
          contracts,
          loading: false,
          error: "",
        }),
      )
      .catch((cause) =>
        setState((current) => ({
          ...current,
          loading: false,
          error: cause.message || "Não foi possível carregar o financeiro.",
        })),
      );
  }, []);
  return state;
}

export function FinanceProductionDashboard({ onNavigate }) {
  const data = useProductionFinance();
  const [period, setPeriod] = useState(currentPeriod);
  const summary = useMemo(
    () => financialDashboard(data.receivables, data.payables, period),
    [data.payables, data.receivables, period],
  );
  const activeContracts = data.contracts.filter(
    (row) => row.status === "active" && !row.deleted_at,
  ).length;
  return (
    <div className="production-finance-page">
      <PageHeader
        eyebrow="Gestão financeira"
        title="Dashboard financeiro"
        description="Receita, despesas, fluxo de caixa e resultado operacional por competência."
        actions={
          <label className="period-filter">
            Competência
            <input
              type="month"
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
            />
          </label>
        }
      />
      {data.error && (
        <FeedbackMessage type="error">{data.error}</FeedbackMessage>
      )}
      <section className="v2-metrics">
        {[
          ["Receita prevista", summary.revenue],
          ["Receita confirmada", summary.received],
          ["Despesas previstas", summary.expense],
          ["Despesas pagas", summary.paidExpense],
          ["Fluxo de caixa realizado", summary.cashFlow],
          ["Resultado operacional", summary.operatingResult],
          ["Contas a receber", summary.receivable],
          ["Contas a pagar", summary.payable],
        ].map(([label, value]) => (
          <article className="v2-metric" key={label}>
            <span>{label}</span>
            <strong>{money(value)}</strong>
          </article>
        ))}
      </section>
      <section className="dashboard-panel finance-production-summary">
        <div>
          <span>Base operacional</span>
          <strong>{activeContracts} contratos ativos</strong>
          <small>
            {summary.income.length} receita(s) e {summary.expenses.length}{" "}
            despesa(s) únicas na competência.
          </small>
        </div>
        <div className="page-actions">
          <button
            className="button secondary"
            onClick={() => onNavigate("cash-flow")}
          >
            Ver fluxo de caixa
          </button>
          <button
            className="button"
            onClick={() => onNavigate("accounting-export")}
          >
            Exportar para Contabilidade
          </button>
        </div>
      </section>
    </div>
  );
}

export function AccountingExportPage() {
  const data = useProductionFinance();
  const [period, setPeriod] = useState(currentPeriod);
  const summary = useMemo(
    () => financialDashboard(data.receivables, data.payables, period),
    [data.payables, data.receivables, period],
  );
  function download() {
    const blob = new Blob(
      [accountingCsv(data.receivables, data.payables, period)],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `mugo-contabilidade-${period}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div>
      <PageHeader
        eyebrow="Contabilidade"
        title="Exportar para Contabilidade"
        description="Arquivo por competência com receitas, despesas, categorias, centros de custo e contas financeiras."
        actions={
          <button
            className="button"
            onClick={download}
            disabled={data.loading || !period}
          >
            <Download size={16} /> Gerar CSV
          </button>
        }
      />
      {data.error && (
        <FeedbackMessage type="error">{data.error}</FeedbackMessage>
      )}
      <section className="dashboard-panel accounting-export-controls">
        <label>
          Competência
          <input
            type="month"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          />
        </label>
        <dl>
          <div>
            <dt>Receitas</dt>
            <dd>{summary.income.length}</dd>
          </div>
          <div>
            <dt>Despesas</dt>
            <dd>{summary.expenses.length}</dd>
          </div>
          <div>
            <dt>Resultado</dt>
            <dd>{money(summary.operatingResult)}</dd>
          </div>
        </dl>
      </section>
      <FeedbackMessage type="info">
        Registros pendentes de revisão não entram no CSV. Nenhum dado é alterado
        durante a exportação.
      </FeedbackMessage>
    </div>
  );
}

const moduleConfig = {
  softwares: {
    title: "Softwares",
    description:
      "Assinaturas e ferramentas recorrentes cadastradas em contas a pagar.",
    matcher: (expense) =>
      /software|assinatura|supabase|chatgpt|canva|claude|google|workspace/i.test(
        `${expense.name} ${expense.description || ""}`,
      ),
  },
  providers: {
    title: "Prestadores",
    description:
      "Fornecedores e profissionais identificados nas despesas da Mugô.",
    matcher: (expense) => Boolean(expense.supplier_name),
  },
  "bank-accounts": {
    title: "Contas bancárias",
    description: "Contas correntes, poupança e contas de pagamento.",
    types: ["checking", "savings", "payment_account", "cash"],
  },
  cards: {
    title: "Cartões",
    description: "Cartões usados para pagamento das despesas empresariais.",
    types: ["credit_card"],
  },
};

export function FinancialMasterDataPage({ section, onNavigate }) {
  const config = moduleConfig[section];
  const { canWrite } = useAuth();
  const [rows, setRows] = useState([]);
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [error, setError] = useState("");
  const accountModule = Boolean(config.types);
  const load = () =>
    (accountModule ? listExpenseLookups() : listExpenses())
      .then((result) => {
        const source = accountModule ? result.accounts : result;
        const filtered = source.filter((row) =>
          accountModule
            ? config.types.includes(row.account_type)
            : config.matcher(row),
        );
        setRows(
          section === "providers"
            ? [
                ...new Map(
                  filtered.map((row) => [
                    row.supplier_name.trim().toLowerCase(),
                    row,
                  ]),
                ).values(),
              ]
            : filtered,
        );
      })
      .catch((cause) =>
        setError(cause.message || "Não foi possível carregar o módulo."),
      );
  useEffect(load, [accountModule, config, section]);
  async function submit(event) {
    event.preventDefault();
    try {
      await createFinancialLookup("financial_accounts", {
        name: name.trim(),
        institution: institution.trim() || null,
        account_type: section === "cards" ? "credit_card" : "checking",
      });
      setName("");
      setInstitution("");
      await load();
    } catch (cause) {
      setError(cause.message);
    }
  }
  return (
    <div>
      <PageHeader
        eyebrow="Administração financeira"
        title={config.title}
        description={config.description}
        actions={
          !accountModule && canWrite ? (
            <button
              className="button"
              onClick={() => onNavigate("accounts-payable")}
            >
              <Plus size={16} /> Cadastrar pela conta a pagar
            </button>
          ) : null
        }
      />
      {error && <FeedbackMessage type="error">{error}</FeedbackMessage>}
      {accountModule && canWrite && (
        <form className="dashboard-panel master-data-form" onSubmit={submit}>
          <label>
            Nome
            <input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Instituição
            <input
              value={institution}
              onChange={(event) => setInstitution(event.target.value)}
            />
          </label>
          <button className="button">Adicionar</button>
        </form>
      )}
      <section className="dashboard-panel master-data-list">
        {rows.map((row) => (
          <article key={row.id || row.supplier_name}>
            <div>
              <strong>
                {section === "providers" ? row.supplier_name : row.name}
              </strong>
              <small>
                {accountModule
                  ? row.institution || "Instituição não informada"
                  : row.supplier_name || row.recurrence_type}
              </small>
            </div>
            <span>{accountModule ? "Ativa" : money(row.total_amount)}</span>
          </article>
        ))}
        {!rows.length && <p>Nenhum registro cadastrado.</p>}
      </section>
    </div>
  );
}
