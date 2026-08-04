import { useEffect, useState } from "react";
import { Download, ShieldCheck } from "lucide-react";
import {
  accountingStandards,
  buildClientSanitationRows,
  buildSanitationAudit,
} from "../lib/financialSanitation";
import {
  groupPossibleDuplicateClients,
  normalizeName,
} from "../lib/clientDeduplication";
import { serializeExport } from "../lib/exportData";
import { listClientsForReview } from "../services/data/clientsRepository";
import { listContracts } from "../services/data/contractsRepository";
import {
  listExpenses,
  listExpenseInstallments,
} from "../services/data/expensesRepository";
import { listInstallments } from "../services/data/financeRepository";
import { FeedbackMessage } from "./FeedbackMessage";
import { PageHeader } from "./PageHeader";

const money = (value) =>
  Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
const groups = [
  ["clients", "Clientes"],
  ["contracts", "Contratos"],
  ["finance", "Financeiro"],
  ["expenses", "Despesas"],
];
const exportNames = [
  "receitas_competencia",
  "recebimentos_caixa",
  "contas_a_receber",
  "despesas_competencia",
  "pagamentos_caixa",
  "contas_a_pagar",
  "clientes_ativos",
  "contratos_ativos",
  "documentos_fiscais",
  "pendencias_contabeis",
  "resumo_mensal",
];
const normalizedStandards = {
  revenue: new Set(accountingStandards.revenue.map(normalizeName)),
  expense: new Set(accountingStandards.expense.map(normalizeName)),
  costCenters: new Set(accountingStandards.costCenters.map(normalizeName)),
};
function downloadCsv(name, rows) {
  const file = serializeExport(rows, "csv"),
    url = URL.createObjectURL(
      new Blob(["\ufeff", file.content], { type: file.mime }),
    ),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${name}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function FinancialSanitationPage() {
  const [data, setData] = useState({
      clients: [],
      contracts: [],
      receivables: [],
      payables: [],
      expenses: [],
    }),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(null),
    [clientQuery, setClientQuery] = useState(""),
    [clientFilter, setClientFilter] = useState("all"),
    [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  useEffect(() => {
    Promise.all([
      listClientsForReview(),
      listContracts(),
      listInstallments(),
      listExpenseInstallments(),
      listExpenses(),
    ])
      .then(([clients, contracts, receivables, payables, expenses]) =>
        setData({ clients, contracts, receivables, payables, expenses }),
      )
      .catch((cause) =>
        setError(
          cause.message || "Não foi possível carregar o painel por RLS.",
        ),
      );
  }, []);
  const duplicateGroups = groupPossibleDuplicateClients(data.clients),
    audit = buildSanitationAudit({ ...data, duplicateGroups });
  const clientRows = buildClientSanitationRows(data.clients, duplicateGroups),
    filteredClients = clientRows.filter(
      (row) =>
        (clientFilter === "all" ||
          (clientFilter === "ready"
            ? row.readyForAccountant
            : clientFilter === "active"
              ? row.status === "active" && !row.deleted_at
              : row.classification === clientFilter)) &&
        `${row.company_name} ${row.trade_name || ""} ${row.contact_name || ""}`
          .toLowerCase()
          .includes(clientQuery.toLowerCase()),
    );
  const periodReceivables = data.receivables.filter((r) =>
      String(r.reference_month || r.due_date).startsWith(period),
    ),
    periodPayables = data.payables.filter((r) =>
      String(r.reference_month || r.due_date).startsWith(period),
    );
  const packages = {
    receitas_competencia: periodReceivables.map((r) => ({
      competencia: r.reference_month,
      cliente: r.clients?.company_name || "",
      documento: r.clients?.document_number || "",
      descricao: r.description || r.installment_type,
      valor: r.amount,
      status: r.status,
      observacao: r.operational_notes || "",
    })),
    recebimentos_caixa: periodReceivables
      .filter((r) => r.paid_at || Number(r.received_amount) > 0)
      .map((r) => ({
        competencia: r.reference_month,
        data_pagamento: r.paid_at,
        cliente: r.clients?.company_name || "",
        valor: r.amount,
        valor_pago: r.received_amount,
        status: r.status,
        forma_pagamento: r.payment_method || "",
      })),
    contas_a_receber: periodReceivables
      .filter((r) => Number(r.amount) > Number(r.received_amount || 0))
      .map((r) => ({
        competencia: r.reference_month,
        vencimento: r.due_date,
        cliente: r.clients?.company_name || "",
        valor: r.amount,
        valor_pago: r.received_amount,
        status: r.status,
      })),
    despesas_competencia: periodPayables.map((r) => ({
      competencia: r.reference_month,
      vencimento: r.due_date,
      fornecedor: r.expenses?.supplier_name || "",
      descricao: r.expenses?.name || "",
      categoria: r.expenses?.expense_categories?.name || "",
      centro_custo: r.expenses?.cost_centers?.name || "",
      valor: r.business_amount,
      status: r.status,
    })),
    pagamentos_caixa: periodPayables
      .filter((r) => r.paid_at || Number(r.paid_amount) > 0)
      .map((r) => ({
        competencia: r.reference_month,
        data_pagamento: r.paid_at,
        fornecedor: r.expenses?.supplier_name || "",
        valor: r.business_amount,
        valor_pago: r.paid_amount,
        forma_pagamento: r.payment_method || "",
      })),
    contas_a_pagar: periodPayables
      .filter((r) => Number(r.amount) > Number(r.paid_amount || 0))
      .map((r) => ({
        competencia: r.reference_month,
        vencimento: r.due_date,
        fornecedor: r.expenses?.supplier_name || "",
        valor: r.business_amount,
        valor_pago: r.paid_amount,
        status: r.status,
      })),
    clientes_ativos: data.clients
      .filter((r) => r.status === "active" && !r.deleted_at)
      .map((r) => ({
        cliente: r.company_name,
        nome_fantasia: r.trade_name || "",
        documento: r.document_number || "",
        contato: r.contact_name || "",
        status: r.status,
      })),
    contratos_ativos: data.contracts
      .filter((r) => r.status === "active" && !r.deleted_at)
      .map((r) => ({
        cliente: r.clients?.company_name || r.client_id,
        contrato: r.contract_number || r.id,
        inicio: r.start_date,
        fim: r.end_date,
        vencimento: r.billing_day,
        valor: r.monthly_value,
        status: r.status,
      })),
    documentos_fiscais: [],
    pendencias_contabeis: audit.underReview.map((r) => ({
      tipo: "parcela",
      registro: r.id,
      competencia: r.reference_month,
      descricao: r.classification.label,
      valor: r.amount,
      status: r.status,
    })),
    resumo_mensal: [
      {
        competencia: period,
        receita_confirmada: audit.confirmedRevenue,
        receita_sob_revisao: audit.reviewRevenue,
        despesas_empresariais: audit.businessExpenses,
        resultado_operacional: audit.confirmedRevenue - audit.businessExpenses,
      },
    ],
  };
  return (
    <div>
      <PageHeader
        eyebrow="Administração"
        title="Saneamento financeiro"
        description="Verdade financeira, preparação contábil e exportações por RLS. Correções permanecem assistidas."
      />
      {error && <FeedbackMessage type="error">{error}</FeedbackMessage>}
      <section className="v2-metrics">
        <article className="v2-metric">
          <span>Receita confirmada</span>
          <strong>{money(audit.confirmedRevenue)}</strong>
        </article>
        <article className="v2-metric muted">
          <span>Receita sob revisão</span>
          <strong>{money(audit.reviewRevenue)}</strong>
        </article>
        <article className="v2-metric">
          <span>Despesas empresariais</span>
          <strong>{money(audit.businessExpenses)}</strong>
        </article>
        <article className="v2-metric">
          <span>Resultado operacional</span>
          <strong>
            {money(audit.confirmedRevenue - audit.businessExpenses)}
          </strong>
        </article>
      </section>
      <section className="dashboard-panel">
        <h2>Organização dos clientes</h2>
        <p>
          Todos os cadastros visíveis por RLS, incluindo leads, inativos e
          arquivados. Nenhuma ação ocorre ao abrir esta lista.
        </p>
        <div className="client-list-toolbar">
          <input
            value={clientQuery}
            onChange={(event) => setClientQuery(event.target.value)}
            placeholder="Buscar cliente ou contato"
          />
          <select
            value={clientFilter}
            onChange={(event) => setClientFilter(event.target.value)}
          >
            <option value="all">Todas as classificações</option>
            <option value="consolidar duplicidade">Precisa consolidar</option>
            <option value="revisar contrato">Precisa corrigir contrato</option>
            <option value="revisar financeiro">
              Precisa revisar financeiro
            </option>
            <option value="completar informações">Cadastro incompleto</option>
            <option value="manter como lead">Lead</option>
            <option value="active">Ativo</option>
            <option value="arquivado">Arquivado</option>
            <option value="decisão necessária">Decisão necessária</option>
            <option value="ready">Pronto para contador</option>
          </select>
        </div>
        <div className="table-scroll">
          <table className="report-table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Status</th>
                <th>Contato</th>
                <th>Contato financeiro</th>
                <th>Contrato ativo</th>
                <th>Mensalidade</th>
                <th>Vencimento</th>
                <th>Próxima parcela</th>
                <th>Em aberto</th>
                <th>Classificação</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {filteredClients.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.company_name}</strong>
                    <small>
                      {row.trade_name || "Sem nome fantasia"} ·{" "}
                      {row.document_number || "Sem documento"}
                    </small>
                  </td>
                  <td>
                    {row.status}
                    {row.deleted_at ? " · arquivado" : ""}
                  </td>
                  <td>
                    {row.contact_name || "—"}
                    <small>{row.phone || "Sem telefone"}</small>
                  </td>
                  <td>
                    {row.billing_contact_name || "—"}
                    <small>
                      {row.billing_contact_phone ||
                        row.billing_contact_email ||
                        "Sem contato financeiro"}
                    </small>
                  </td>
                  <td>
                    {row.activeContract?.contract_number ||
                      row.activeContract?.id ||
                      "—"}
                  </td>
                  <td>{money(row.activeContract?.monthly_value)}</td>
                  <td>
                    {row.activeContract?.billing_day
                      ? `Dia ${row.activeContract.billing_day}`
                      : "—"}
                  </td>
                  <td>{row.nextInstallment?.due_date || "—"}</td>
                  <td>{money(row.openAmount)}</td>
                  <td>
                    {row.readyForAccountant
                      ? "Pronto para contador"
                      : row.classification}
                  </td>
                  <td>
                    <button
                      className="button secondary small"
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent("mugo:navigate", {
                            detail: "client-duplicates",
                            clientId: row.id,
                          }),
                        )
                      }
                    >
                      {row.recommendedAction}
                    </button>
                  </td>
                </tr>
              ))}
              {!filteredClients.length && (
                <tr>
                  <td colSpan="11">Nenhum cliente neste filtro.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="sanitation-sections">
        {groups.map(([key, label]) => (
          <article className="dashboard-panel" key={key}>
            <h2>{label}</h2>
            {audit.checklist[key].map(([name, count]) => (
              <button
                className="sanitation-check"
                key={name}
                onClick={() => setSelected({ key, name, count })}
              >
                <span>{count === 0 ? "✓" : "!"}</span>
                <strong>{name}</strong>
                <b>{count}</b>
              </button>
            ))}
          </article>
        ))}
      </section>
      {selected && (
        <section className="dashboard-panel">
          <h2>{selected.name}</h2>
          <p>
            {selected.count} registro(s) requerem conferência. Use as telas
            operacionais correspondentes; este painel não oferece alteração em
            massa.
          </p>
          <button
            className="button secondary"
            onClick={() => setSelected(null)}
          >
            Fechar
          </button>
        </section>
      )}
      <section className="dashboard-panel">
        <h2>Verdade das parcelas</h2>
        <div className="table-scroll">
          <table className="report-table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Contrato</th>
                <th>Competência</th>
                <th>Vencimento</th>
                <th>Valor</th>
                <th>Status</th>
                <th>Recebido</th>
                <th>Pago em</th>
                <th>Método</th>
                <th>Idempotência</th>
                <th>Classificação</th>
              </tr>
            </thead>
            <tbody>
              {audit.classifications.map((r) => (
                <tr key={r.id}>
                  <td>{r.clients?.company_name || r.client_id}</td>
                  <td>{r.contract_id || "Sem contrato"}</td>
                  <td>{r.reference_month || "Sem competência"}</td>
                  <td>{r.due_date}</td>
                  <td>{money(r.amount)}</td>
                  <td>{r.status}</td>
                  <td>{money(r.received_amount)}</td>
                  <td>{r.paid_at || "—"}</td>
                  <td>{r.payment_method || "—"}</td>
                  <td>{r.idempotency_key || "—"}</td>
                  <td>{r.classification.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="dashboard-panel">
        <h2>Padrão contábil sugerido</h2>
        <p>
          {normalizedStandards.revenue.size} categorias de receita ·{" "}
          {normalizedStandards.expense.size} categorias de despesa ·{" "}
          {normalizedStandards.costCenters.size} centros de custo, normalizados
          sem duplicação por acentuação, caixa ou espaços.
        </p>
        <div className="accounting-standards">
          <div>
            <strong>Receitas</strong>
            <p>{accountingStandards.revenue.join(" · ")}</p>
          </div>
          <div>
            <strong>Despesas</strong>
            <p>{accountingStandards.expense.join(" · ")}</p>
          </div>
          <div>
            <strong>Centros de custo</strong>
            <p>{accountingStandards.costCenters.join(" · ")}</p>
          </div>
        </div>
      </section>
      <section className="dashboard-panel">
        <h2>Fechamento mensal e pacote do contador</h2>
        <label>
          Competência{" "}
          <input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
        </label>
        <FeedbackMessage type="info">
          Estado atual: aberto. Fechar, reabrir ou marcar como enviado dependerá
          da migration aditiva e de confirmação autorizada.
        </FeedbackMessage>
        <div className="report-options">
          {exportNames.map((name) => (
            <article key={name}>
              <strong>{name}.csv</strong>
              <span>{packages[name].length} linha(s) para conferência</span>
              <button
                className="button secondary small"
                onClick={() => downloadCsv(name, packages[name])}
              >
                <Download size={14} />
                Baixar
              </button>
            </article>
          ))}
        </div>
        <p>
          <ShieldCheck size={15} /> O pacote exclui tokens, chaves, conversas e
          dados técnicos internos.
        </p>
      </section>
    </div>
  );
}
