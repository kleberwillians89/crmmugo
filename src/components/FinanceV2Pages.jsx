import { useEffect, useMemo, useState } from "react";
import { Download, Plus, ReceiptText } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import {
  businessShare,
  mergeCashFlow,
  summarizeExpenses,
} from "../lib/expenseMetrics";
import { listInstallments } from "../services/data/financeRepository";
import {
  createExpense,
  listExpenseInstallments,
  listExpenseLookups,
  markExpensePaid,
} from "../services/data/expensesRepository";
import { listContracts } from "../services/data/contractsRepository";
import { listClients } from "../services/data/clientsRepository";
import { listConversationLinks } from "../services/data/whatsappClientLinksRepository";
import {
  isValidBrazilianPhone,
  normalizeBrazilianPhone,
} from "../lib/whatsapp";
import { PageHeader } from "./PageHeader";
import { FeedbackMessage } from "./FeedbackMessage";

const money = (value) =>
  Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
const date = (value) =>
  value
    ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString(
        "pt-BR",
      )
    : "—";
const initial = {
  name: "",
  supplier_name: "",
  total_amount: "",
  scope: "pending_review",
  business_percentage: 0,
  recurrence_type: "once",
  start_date: new Date().toISOString().slice(0, 10),
  due_day: "",
  installment_count: 1,
  category_id: "",
  cost_center_id: "",
  financial_account_id: "",
  status: "pending",
  validated: false,
};
const suggestions = [
  ["Supabase", "Danilo", null],
  ["ChatGPT Danilo", "Danilo", 120],
  ["ChatGPT Mugô", "Mugô", 120],
  ["Canva", "Mugô", 40],
  ["Claude", "Danilo", null],
  ["Duda", "Prestador/equipe a validar", 1000],
  ["Wanderson", "Prestador/equipe a validar", 700],
  ["Google Drive / Google Workspace", "Mugô", null],
];

function useFinanceData() {
  const [state, setState] = useState({
    receivables: [],
    payables: [],
    contracts: [],
    loading: true,
    error: "",
  });
  const load = () =>
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
      .catch(() =>
        setState((current) => ({
          ...current,
          loading: false,
          error:
            "A estrutura de contas a pagar ainda não está disponível. Aplique a migration V2 no Supabase.",
        })),
      );
  useEffect(load, []);
  return { ...state, reload: load };
}
function Metric({ label, value, muted }) {
  return (
    <article className={`v2-metric${muted ? " muted" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

export function FinanceSummaryPage({ onNavigate }) {
  const data = useFinanceData(),
    expenses = summarizeExpenses(data.payables),
    received = data.receivables.reduce(
      (sum, item) => sum + Number(item.received_amount || 0),
      0,
    ),
    expected = data.receivables.reduce(
      (sum, item) => sum + Number(item.amount || 0),
      0,
    ),
    mrr = data.contracts
      .filter((item) => item.status === "active")
      .reduce((sum, item) => sum + Number(item.monthly_value || 0), 0),
    overdue = data.receivables
      .filter((item) => item.status === "overdue")
      .reduce(
        (sum, item) =>
          sum +
          Math.max(
            Number(item.amount || 0) - Number(item.received_amount || 0),
            0,
          ),
        0,
      );
  return (
    <div>
      <PageHeader
        eyebrow="Gestão financeira"
        title="Resumo financeiro"
        description="Receita, despesas e resultado empresarial em uma visão acionável."
      />
      {data.error && (
        <FeedbackMessage type="info">{data.error}</FeedbackMessage>
      )}
      <section className="v2-metrics">
        <Metric label="Receita contratada" value={money(expected)} />
        <Metric label="Receita recebida" value={money(received)} />
        <Metric label="Receita em aberto" value={money(expected - received)} />
        <Metric
          label="Despesas empresariais"
          value={money(expenses.business)}
        />
        <Metric
          label="Resultado operacional"
          value={money(received - expenses.paid)}
        />
        <Metric label="MRR" value={money(mrr)} />
        <Metric label="Inadimplência" value={money(overdue)} muted={!overdue} />
        <Metric
          label="Setups"
          value={money(
            data.contracts.reduce(
              (sum, item) => sum + Number(item.setup_value || 0),
              0,
            ),
          )}
        />
      </section>
      <section className="dashboard-panel v2-action-panel">
        <div>
          <h2>Próximos passos</h2>
          <p>
            Revise contas pendentes antes de incluí-las nos indicadores
            oficiais.
          </p>
        </div>
        <div>
          <button
            className="button"
            onClick={() => onNavigate("accounts-payable")}
          >
            Abrir contas a pagar
          </button>
          <button
            className="button secondary"
            onClick={() => onNavigate("client-contract-review")}
          >
            Revisar clientes e contratos
          </button>
        </div>
      </section>
    </div>
  );
}

export function AccountsPayablePage() {
  const { canWrite } = useAuth(),
    data = useFinanceData(),
    [lookups, setLookups] = useState({
      categories: [],
      costCenters: [],
      accounts: [],
    }),
    [form, setForm] = useState(initial),
    [open, setOpen] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    listExpenseLookups()
      .then(setLookups)
      .catch(() => {});
  }, []);
  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const total = Number(form.total_amount),
        percentage =
          form.scope === "business"
            ? 100
            : form.scope === "shared"
              ? Number(form.business_percentage)
              : 0;
      await createExpense({
        ...form,
        total_amount: total,
        business_percentage: percentage,
        due_day: form.due_day ? Number(form.due_day) : null,
        installment_count: Number(form.installment_count) || 1,
        category_id: form.category_id || null,
        cost_center_id: form.cost_center_id || null,
        financial_account_id: form.financial_account_id || null,
      });
      setForm(initial);
      setOpen(false);
      await data.reload();
    } catch (cause) {
      setError(cause.message || "Não foi possível salvar a conta.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div>
      <PageHeader
        eyebrow="Financeiro"
        title="Contas a pagar"
        description="Entrada única para softwares, prestadores, infraestrutura e despesas recorrentes ou variáveis."
        actions={
          canWrite && (
            <button className="button" onClick={() => setOpen(!open)}>
              <Plus size={16} />
              Nova conta
            </button>
          )
        }
      />
      {(data.error || error) && (
        <FeedbackMessage type="error">{error || data.error}</FeedbackMessage>
      )}
      {open && (
        <form className="dashboard-panel expense-form" onSubmit={submit}>
          <h2>Nova conta</h2>
          <div className="form-grid">
            <label>
              Descrição
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label>
              Fornecedor
              <input
                value={form.supplier_name}
                onChange={(e) =>
                  setForm({ ...form, supplier_name: e.target.value })
                }
              />
            </label>
            <label>
              Valor total
              <input
                required
                min="0"
                step="0.01"
                type="number"
                value={form.total_amount}
                onChange={(e) =>
                  setForm({ ...form, total_amount: e.target.value })
                }
              />
            </label>
            <label>
              Escopo
              <select
                value={form.scope}
                onChange={(e) => setForm({ ...form, scope: e.target.value })}
              >
                <option value="pending_review">Pendente de revisão</option>
                <option value="business">Empresarial</option>
                <option value="personal">Pessoal</option>
                <option value="shared">Compartilhada</option>
              </select>
            </label>
            {form.scope === "shared" && (
              <label>
                Percentual Mugô
                <input
                  type="number"
                  min="0.01"
                  max="100"
                  step="0.01"
                  value={form.business_percentage}
                  onChange={(e) =>
                    setForm({ ...form, business_percentage: e.target.value })
                  }
                />
              </label>
            )}
            <label>
              Recorrência
              <select
                value={form.recurrence_type}
                onChange={(e) =>
                  setForm({ ...form, recurrence_type: e.target.value })
                }
              >
                <option value="once">Única</option>
                <option value="monthly">Mensal</option>
                <option value="installments">Parcelada</option>
              </select>
            </label>
            <label>
              Início
              <input
                type="date"
                value={form.start_date}
                onChange={(e) =>
                  setForm({ ...form, start_date: e.target.value })
                }
              />
            </label>
            <label>
              Dia do vencimento
              <input
                type="number"
                min="1"
                max="31"
                value={form.due_day}
                onChange={(e) => setForm({ ...form, due_day: e.target.value })}
              />
            </label>
            <label>
              Parcelas
              <input
                type="number"
                min="1"
                value={form.installment_count}
                onChange={(e) =>
                  setForm({ ...form, installment_count: e.target.value })
                }
              />
            </label>
            <label>
              Categoria
              <select
                value={form.category_id}
                onChange={(e) =>
                  setForm({ ...form, category_id: e.target.value })
                }
              >
                <option value="">Sem categoria</option>
                {lookups.categories.map((x) => (
                  <option value={x.id} key={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Centro de custo
              <select
                value={form.cost_center_id}
                onChange={(e) =>
                  setForm({ ...form, cost_center_id: e.target.value })
                }
              >
                <option value="">Sem centro</option>
                {lookups.costCenters.map((x) => (
                  <option value={x.id} key={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-preview">
            Valor empresarial:{" "}
            <strong>
              {money(
                businessShare({
                  scope: form.scope,
                  amount: form.total_amount,
                  business_percentage: form.business_percentage,
                }),
              )}
            </strong>
          </div>
          <button className="button" disabled={saving}>
            {saving ? "Salvando…" : "Salvar e gerar parcelas"}
          </button>
        </form>
      )}
      <PayablesTable
        rows={data.payables}
        canWrite={canWrite}
        onCreate={() => setOpen(true)}
        onPaid={async (row) => {
          await markExpensePaid(row.id, { paid_amount: row.amount });
          data.reload();
        }}
      />
    </div>
  );
}
function PayablesTable({ rows, canWrite, onPaid, onCreate }) {
  if (!rows.length)
    return (
      <section className="dashboard-panel compact-empty-state">
        <strong>Nenhuma conta cadastrada</strong>
        <p>
          Cadastre aqui softwares, prestadores, infraestrutura e qualquer outra
          despesa da Mugô.
        </p>
        {canWrite && (
          <button className="button" onClick={onCreate}>
            Cadastrar primeira conta
          </button>
        )}
      </section>
    );
  return (
    <section className="dashboard-panel">
      <div className="table-scroll">
        <table className="report-table">
          <thead>
            <tr>
              <th>Conta</th>
              <th>Vencimento</th>
              <th>Escopo</th>
              <th>Valor</th>
              <th>Mugô</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <strong>{row.expenses?.name}</strong>
                  <small>
                    {row.expenses?.supplier_name || "Fornecedor não informado"}
                  </small>
                </td>
                <td>{date(row.due_date)}</td>
                <td>{row.expenses?.scope}</td>
                <td>{money(row.amount)}</td>
                <td>{money(row.business_amount)}</td>
                <td>{row.status}</td>
                <td>
                  {canWrite && row.status !== "paid" && (
                    <button
                      className="button secondary small"
                      onClick={() => onPaid(row)}
                    >
                      Marcar paga
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function RecurringAccountsPage({ onNavigate }) {
  return (
    <div>
      <PageHeader
        eyebrow="Financeiro"
        title="Contas recorrentes"
        description="Sugestões informadas, sem inclusão automática na base."
      />
      <FeedbackMessage type="info">
        Estes itens são apenas uma fila de revisão. Nada será salvo até
        confirmação explícita.
      </FeedbackMessage>
      <section className="review-grid">
        {suggestions.map(([name, responsible, value]) => (
          <article className="review-card" key={name}>
            <ReceiptText size={20} />
            <div>
              <strong>{name}</strong>
              <span>
                {value ? money(value) : "Valor pendente"} · {responsible}
              </span>
              <small>Pendente de validação</small>
            </div>
          </article>
        ))}
      </section>
      <button className="button" onClick={() => onNavigate("accounts-payable")}>
        Cadastrar conta validada
      </button>
    </div>
  );
}
export function CashFlowPage() {
  const data = useFinanceData(),
    rows = mergeCashFlow(data.receivables, data.payables);
  return (
    <div>
      <PageHeader
        eyebrow="Financeiro"
        title="Fluxo de caixa"
        description="Entradas e saídas empresariais previstas por vencimento."
      />
      {rows.length ? (
        <section className="dashboard-panel">
          <div className="table-scroll">
            <table className="report-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Movimento</th>
                  <th>Tipo</th>
                  <th>Valor</th>
                  <th>Saldo projetado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{date(row.date)}</td>
                    <td>{row.label}</td>
                    <td>{row.type === "in" ? "Entrada" : "Saída"}</td>
                    <td>{money(row.amount)}</td>
                    <td>{money(row.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="dashboard-panel compact-empty-state">
          <strong>Fluxo de caixa ainda vazio</strong>
          <p>
            Cadastre contratos com parcelas e contas a pagar para visualizar
            entradas e saídas.
          </p>
        </section>
      )}
    </div>
  );
}

function csv(rows) {
  const header = ["Data", "Tipo", "Descrição", "Valor", "Saldo projetado"];
  const cells = [
    header,
    ...rows.map((r) => [
      r.date,
      r.type === "in" ? "Entrada" : "Saída",
      r.label,
      r.amount,
      r.balance,
    ]),
  ];
  return cells
    .map((row) =>
      row
        .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`)
        .join(";"),
    )
    .join("\n");
}
export function FinancialReportsPage() {
  const data = useFinanceData(),
    rows = mergeCashFlow(data.receivables, data.payables);
  function download() {
    const blob = new Blob(
        [
          `sep=;\nOrganização;Agência Mugô\nGerado em;${new Date().toLocaleString("pt-BR")}\n\n${csv(rows)}`,
        ],
        { type: "text/csv;charset=utf-8" },
      ),
      url = URL.createObjectURL(blob),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `mugo-movimentacoes-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div>
      <PageHeader
        eyebrow="Contabilidade"
        title="Relatórios financeiros"
        description="Exportações claras por competência e movimentação, sem dados pessoais desnecessários."
        actions={
          <button className="button" onClick={download}>
            <Download size={16} />
            Exportar movimentações CSV
          </button>
        }
      />
      <section className="report-options">
        {[
          "Receitas por competência",
          "Recebimentos por data",
          "Contas a pagar",
          "Despesas por categoria",
          "Despesas por centro de custo",
          "Empresariais x pessoais",
          "Fluxo de caixa",
          "Inadimplência",
          "Contratos ativos",
          "Clientes ativos",
        ].map((item) => (
          <article key={item}>
            <strong>{item}</strong>
            <span>Disponível na consolidação CSV da V2</span>
          </article>
        ))}
      </section>
    </div>
  );
}

const informed = [
  ["Amalie", 4000, 20, "active"],
  ["Roove", 3200, 20, "active"],
  ["Origami", 1500, 7, "active"],
  ["Gabi", 5000, null, "active"],
  ["Curavino", 1500, 7, "validar"],
  ["Santo Circuito", null, null, "definição"],
];
export function ClientContractReviewPage() {
  const [clients, setClients] = useState([]),
    [contracts, setContracts] = useState([]),
    [links, setLinks] = useState([]),
    [error, setError] = useState("");
  useEffect(() => {
    Promise.all([
      listClients(),
      listContracts(),
      listConversationLinks().catch(() => []),
    ])
      .then(([a, b, c]) => {
        setClients(a);
        setContracts(b);
        setLinks(c);
      })
      .catch(() =>
        setError("Não foi possível carregar os cadastros para comparação."),
      );
  }, []);
  const phoneCounts = useMemo(() => {
    const counts = new Map();
    clients.forEach((client) =>
      [client.phone, client.billing_contact_phone].forEach((phone) => {
        const normalized = normalizeBrazilianPhone(phone);
        if (normalized)
          counts.set(normalized, (counts.get(normalized) || 0) + 1);
      }),
    );
    return counts;
  }, [clients]);
  const rows = useMemo(
    () =>
      informed.map(([name, value, day, status]) => {
        const normalized = name.toLowerCase(),
          matches = clients.filter(
            (c) =>
              `${c.company_name} ${c.trade_name || ""}`
                .toLowerCase()
                .includes(normalized) ||
              normalized.includes(String(c.company_name).toLowerCase()),
          ),
          client = matches.length === 1 ? matches[0] : null,
          contract = client
            ? contracts.find(
                (c) => c.client_id === client.id && c.status === "active",
              ) || contracts.find((c) => c.client_id === client.id)
            : null,
          installments = (contract?.invoice_installments || []).filter(
            (item) =>
              item.status !== "paid" &&
              String(item.due_date) >= new Date().toISOString().slice(0, 10),
          ),
          services = contract?.services || contract?.contract_services || [],
          primary = normalizeBrazilianPhone(client?.phone),
          billing = normalizeBrazilianPhone(client?.billing_contact_phone),
          linked = client
            ? links.filter((link) => link.client_id === client.id)
            : [];
        return {
          name,
          value,
          day,
          status,
          matches,
          client,
          contract,
          installments,
          services,
          primary,
          billing,
          linked,
        };
      }),
    [clients, contracts, links],
  );
  return (
    <div>
      <PageHeader
        eyebrow="Administração"
        title="Revisão de clientes e contratos"
        description="Comparação somente leitura, incluindo impacto financeiro e saúde do vínculo WhatsApp."
      />
      {error && <FeedbackMessage type="error">{error}</FeedbackMessage>}
      <section className="client-review-stack">
        {rows.map((row) => (
          <article
            className="dashboard-panel client-review-card"
            key={row.name}
          >
            <header>
              <div>
                <h2>{row.name}</h2>
                <p>
                  {row.matches.length === 0
                    ? "Cliente não encontrado"
                    : row.matches.length > 1
                      ? `${row.matches.length} possíveis correspondências — atualização bloqueada`
                      : `${row.client.company_name} · ${row.client.trade_name || "sem nome fantasia"}`}
                </p>
              </div>
              <span
                className={`review-status ${row.matches.length === 1 ? "ok" : "warning"}`}
              >
                {row.matches.length === 1 ? "Correspondência única" : "Revisar"}
              </span>
            </header>
            {row.client && (
              <>
                <div className="client-review-columns">
                  <dl>
                    <div>
                      <dt>Contato principal</dt>
                      <dd>{row.client.contact_name || "Não informado"}</dd>
                    </div>
                    <div>
                      <dt>Telefone principal</dt>
                      <dd>{row.client.phone || "Não informado"}</dd>
                    </div>
                    <div>
                      <dt>Contato financeiro</dt>
                      <dd>
                        {row.client.billing_contact_name || "Não informado"}
                      </dd>
                    </div>
                    <div>
                      <dt>Telefone financeiro</dt>
                      <dd>
                        {row.client.billing_contact_phone || "Não informado"}
                      </dd>
                    </div>
                  </dl>
                  <dl>
                    <div>
                      <dt>Contrato atual</dt>
                      <dd>
                        {row.contract?.contract_number || "Não encontrado"}
                      </dd>
                    </div>
                    <div>
                      <dt>Valor mensal</dt>
                      <dd>
                        {money(row.contract?.monthly_value)} →{" "}
                        {row.value ? money(row.value) : "Pendente"}
                      </dd>
                    </div>
                    <div>
                      <dt>Vencimento</dt>
                      <dd>
                        {row.contract?.billing_day || "Não informado"} →{" "}
                        {row.day || "Pendente"}
                      </dd>
                    </div>
                    <div>
                      <dt>Status</dt>
                      <dd>
                        {row.contract?.status || "Sem contrato"} → {row.status}
                      </dd>
                    </div>
                  </dl>
                </div>
                <div className="client-review-impact">
                  <strong>Impacto potencial</strong>
                  <span>
                    {row.installments.length} parcela(s) futura(s); parcelas
                    pagas não seriam alteradas.
                  </span>
                  <span>
                    {row.services.length
                      ? row.services
                          .map(
                            (service) =>
                              service.serviceName || service.service_name,
                          )
                          .join(" · ")
                      : "Serviços não informados"}
                  </span>
                </div>
                <div className="whatsapp-audit-row">
                  <span>
                    Principal: {row.primary || "ausente"} ·{" "}
                    {isValidBrazilianPhone(row.client.phone)
                      ? "válido"
                      : "inválido"}
                    {phoneCounts.get(row.primary) > 1
                      ? " · possível duplicidade"
                      : ""}
                  </span>
                  <span>
                    Financeiro: {row.billing || "ausente"} ·{" "}
                    {isValidBrazilianPhone(row.client.billing_contact_phone)
                      ? "válido"
                      : "inválido"}
                    {phoneCounts.get(row.billing) > 1
                      ? " · possível duplicidade"
                      : ""}
                  </span>
                  <span>
                    {row.linked.length
                      ? `${row.linked.length} conversa(s) vinculada(s)`
                      : "Nenhuma conversa vinculada"}
                  </span>
                </div>
              </>
            )}
          </article>
        ))}
      </section>
      <FeedbackMessage type="info">
        Nenhuma ação de atualização está disponível nesta fase. Alterações
        futuras deverão apresentar prévia das parcelas, preservar pagamentos e
        exigir confirmação para regeneração.
      </FeedbackMessage>
    </div>
  );
}
