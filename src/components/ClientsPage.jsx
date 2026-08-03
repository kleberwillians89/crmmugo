/* eslint-disable react-hooks/preserve-manual-memoization */
import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "./PageHeader";
import { FeedbackMessage } from "./FeedbackMessage";
import {
  archiveClient,
  createClient,
  findPossibleDuplicateClients,
  getClient,
  groupPossibleDuplicateClients,
  listClientsForReview,
  reactivateClient,
  updateClient,
} from "../services/data/clientsRepository";
import { createSignedUrl } from "../services/data/documentsRepository";
import { getOrganizationSettings } from "../services/data/settingsRepository";
import { recordBillingPrepared } from "../services/data/financeRepository";
import { dataProvider } from "../lib/supabase/client";
import { useAuth } from "../contexts/AuthContext";
import { userError } from "../lib/userError";
import { calculateFinancialSummary } from "../lib/financialMetrics";
import {
  buildMonthlyBillingMessage,
  buildSetupBillingMessage,
  isValidBrazilianPhone,
} from "../lib/whatsapp";
import { WhatsAppReviewModal } from "./WhatsAppReviewModal";
import { normalizeService } from "../lib/normalizeService";
import { Plus, Search, X } from "lucide-react";
import { compareClients } from "../lib/clientDeduplication";
import { listClientMergeHistory } from "../services/data/clientMergeRepository";

const empty = {
  company_name: "",
  trade_name: "",
  contact_name: "",
  document_number: "",
  email: "",
  phone: "",
  billing_contact_name: "",
  billing_contact_email: "",
  billing_contact_phone: "",
  billing_contact_role: "",
  website: "",
  instagram: "",
  segment: "",
  lead_source: "",
  status: "lead",
  notes: "",
};
const labels = {
  company_name: "Empresa",
  trade_name: "Nome fantasia",
  contact_name: "Contato comercial",
  document_number: "Documento",
  email: "E-mail comercial",
  phone: "Telefone comercial",
  billing_contact_name: "Contato financeiro",
  billing_contact_email: "E-mail financeiro",
  billing_contact_phone: "Telefone financeiro",
  billing_contact_role: "Função do contato financeiro",
  website: "Site",
  instagram: "Instagram",
  segment: "Segmento",
  lead_source: "Origem",
};
const money = (value) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    value || 0,
  );

function CenterTable({ title, headers, rows }) {
  return (
    <section className="dashboard-panel client-section">
      <h2>{title}</h2>
      <div className="table-scroll">
        <table className="report-table">
          <thead>
            <tr>
              {headers.map((header) => (
                <th key={header}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {row.map((value, column) => (
                  <td key={column}>{value ?? "Não informado"}</td>
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={headers.length}>Nenhum registro.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ClientCenter({ id, onBack }) {
  const { canWrite } = useAuth();
  const [client, setClient] = useState(null),
    [settings, setSettings] = useState({}),
    [whatsapp, setWhatsapp] = useState(null),
    [candidates, setCandidates] = useState([]),
    [mergeHistory, setMergeHistory] = useState([]),
    [error, setError] = useState("");
  useEffect(() => {
    getClient(id)
      .then(async (row) => {
        setClient(row);
        const all = await listClientsForReview();
        setCandidates(
          all
            .map((item) => ({
              client: item,
              comparison: compareClients(row, item),
            }))
            .filter(
              (item) =>
                item.client.id !== row.id &&
                ["strong", "partial"].includes(item.comparison.level),
            ),
        );
      })
      .catch((cause) => setError(userError(cause)));
    getOrganizationSettings()
      .then(setSettings)
      .catch(() => {});
    listClientMergeHistory()
      .then((rows) =>
        setMergeHistory(
          rows.filter(
            (batch) =>
              batch.primary_client_id === id ||
              batch.secondary_client_ids?.includes(id),
          ),
        ),
      )
      .catch(() => {});
  }, [id]);
  if (error) return <FeedbackMessage type="error">{error}</FeedbackMessage>;
  if (!client) return <p>Carregando cliente…</p>;
  const proposals = client.proposals || [],
    contracts = client.contracts || [],
    docs = client.documents || [],
    installments = client.invoice_installments || [],
    won = proposals.filter((proposal) => proposal.status === "won"),
    active = contracts.filter((contract) => contract.status === "active"),
    financial = calculateFinancialSummary(contracts, installments);
  const monthlyPlanned = financial.monthlyExpected + financial.monthlyEstimated,
    totalContracted = financial.totalExpected;
  const serviceRows = contracts.flatMap((contract) =>
    (contract.contract_services || []).map((row) => {
      const service = normalizeService(row);
      return [
        service.serviceName,
        service.statusLabel,
        service.scopeSummary || "Não informado",
        service.deliverables || "Não informadas",
        service.commercialResponsible?.name || "Sem responsável",
        service.deliveryResponsible?.name || "Sem responsável",
        service.supportResponsible?.name || "Sem responsável",
        contract.start_date || "Não informado",
        contract.end_date || "Sem data final",
        money(service.monthlyValue || service.oneTimeValue),
      ];
    }),
  );
  async function openDoc(doc) {
    try {
      const data = await createSignedUrl(doc.storage_path);
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (cause) {
      setError(userError(cause, "O link temporário não pôde ser criado."));
    }
  }
  function contact() {
    const financialPhone = isValidBrazilianPhone(client.billing_contact_phone);
    return {
      phone: financialPhone ? client.billing_contact_phone : client.phone,
      name:
        client.billing_contact_name ||
        client.contact_name ||
        client.company_name,
      source: financialPhone ? "contato financeiro" : "telefone principal",
    };
  }
  function prepareBilling() {
    const target = contact();
    if (!isValidBrazilianPhone(target.phone)) {
      setError("O cliente não possui telefone financeiro ou principal válido.");
      return;
    }
    const setup = contracts.find(
      (contract) =>
        Number(contract.setup_value || 0) >
        Number(contract.setup_received_amount || 0),
    );
    const installment =
      installments.find((item) => item.status === "overdue") ||
      installments.find((item) => item.status === "pending");
    if (setup) {
      const pending = Math.max(
        Number(setup.setup_value || 0) -
          Number(setup.setup_received_amount || 0),
        0,
      );
      setWhatsapp({
        client: client.company_name,
        phone: target.phone,
        phoneSource: target.source,
        type: "Setup",
        contract: setup.contract_number,
        value: money(setup.setup_value),
        received: money(setup.setup_received_amount),
        balance: money(pending),
        dueDate: setup.start_date,
        pixKey: settings.pix_key,
        bankName: settings.bank_name,
        message: buildSetupBillingMessage({
          name: target.name,
          setupTotal: money(setup.setup_value),
          setupReceived: money(setup.setup_received_amount),
          setupPending: money(pending),
          dueDate: setup.start_date,
          pixKey: settings.pix_key,
          bankName: settings.bank_name,
        }),
        clientId: client.id,
        contractId: setup.id,
        billingType: "setup",
      });
    } else if (installment) {
      setWhatsapp({
        client: client.company_name,
        phone: target.phone,
        phoneSource: target.source,
        type:
          installment.status === "overdue"
            ? "Mensalidade vencida"
            : "Mensalidade",
        contract: contracts.find(
          (contract) => contract.id === installment.contract_id,
        )?.contract_number,
        reference: installment.reference_month,
        value: money(installment.amount),
        dueDate: installment.due_date,
        pixKey: settings.pix_key,
        bankName: settings.bank_name,
        message: buildMonthlyBillingMessage({
          name: target.name,
          reference: installment.reference_month,
          value: money(installment.amount),
          dueDate: installment.due_date,
          pixKey: settings.pix_key,
          bankName: settings.bank_name,
          overdue: installment.status === "overdue",
        }),
        clientId: client.id,
        contractId: installment.contract_id,
        billingType: "installment",
      });
    } else
      setError("Não há setup ou mensalidade pendente para preparar cobrança.");
  }
  return (
    <div>
      <button className="button secondary small" onClick={onBack}>
        Voltar aos clientes
      </button>
      <PageHeader
        eyebrow="Centro do cliente"
        title={client.company_name}
        description={`${client.trade_name || "Nome fantasia não informado"} · ${client.contact_name || "Contato não informado"}`}
      />
      {candidates.length > 0 && (
        <section className="client-duplicate-banner">
          <div>
            <strong>
              Encontramos outros cadastros que podem pertencer a este cliente.
            </strong>
            <span>
              {candidates
                .map(
                  (item) =>
                    `${item.client.company_name} (${item.comparison.level === "strong" ? "alta" : "média"} confiança)`,
                )
                .join(" · ")}
            </span>
          </div>
          <button
            className="button secondary small"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("mugo:navigate", {
                  detail: "client-duplicates",
                }),
              )
            }
          >
            Revisar duplicidades
          </button>
        </section>
      )}
      <section className="client-head dashboard-panel">
        <h2>Contatos</h2>
        <dl>
          <div>
            <dt>Status</dt>
            <dd>{client.status}</dd>
          </div>
          <div>
            <dt>Contato comercial</dt>
            <dd>{client.contact_name || "Não informado"}</dd>
          </div>
          <div>
            <dt>Telefone comercial</dt>
            <dd>{client.phone || "Não informado"}</dd>
          </div>
          <div>
            <dt>E-mail comercial</dt>
            <dd>{client.email || "Não informado"}</dd>
          </div>
          <div>
            <dt>Contato financeiro</dt>
            <dd>{client.billing_contact_name || "Não informado"}</dd>
          </div>
          <div>
            <dt>Telefone financeiro</dt>
            <dd>{client.billing_contact_phone || "Não informado"}</dd>
          </div>
          <div>
            <dt>E-mail financeiro</dt>
            <dd>{client.billing_contact_email || "Não informado"}</dd>
          </div>
          <div>
            <dt>Função financeira</dt>
            <dd>{client.billing_contact_role || "Não informada"}</dd>
          </div>
        </dl>
      </section>
      <section className="dashboard-panel client-section">
        <header className="client-financial-header">
          <div>
            <h2>Visão financeira</h2>
            <p>
              {candidates.length
                ? "Valores confirmados deste cadastro; possíveis duplicidades não são somadas."
                : "Receita contratada, sem incluir propostas apenas enviadas."}
            </p>
          </div>
          {canWrite && (
            <button className="button secondary small" onClick={prepareBilling}>
              Enviar cobrança pelo WhatsApp
            </button>
          )}
        </header>
        <div className="client-financial-grid">
          {[
            [
              "Setup contratado",
              financial.setupContracted,
              contracts.some((item) => item.setup_value != null),
            ],
            ["Setup recebido", financial.setupReceived, true],
            ["Setup pendente", financial.setupPending, true],
            [
              financial.hasEstimatedMonthlyRevenue
                ? "Mensalidades previstas (estimativa)"
                : "Mensalidades previstas",
              monthlyPlanned,
              installments.length > 0 || financial.hasEstimatedMonthlyRevenue,
            ],
            ["Mensalidades recebidas", financial.monthlyReceived, true],
            ["Mensalidades em aberto", financial.monthlyPending, true],
            ["Mensalidades vencidas", financial.monthlyOverdue, true],
            [
              "Total contratado",
              totalContracted,
              contracts.length > 0 || installments.length > 0,
            ],
            ["Total recebido", financial.totalReceived, true],
            ["Saldo em aberto", financial.totalOpen, true],
          ].map(([label, value, known]) => (
            <article className="business-stat" key={label}>
              <span>{label}</span>
              <strong>{known ? money(value) : "Não informado"}</strong>
            </article>
          ))}
        </div>
      </section>
      <section className="performance-stats">
        {[
          ["Propostas", proposals.length],
          [
            "Abertas",
            proposals.filter(
              (proposal) =>
                !["won", "lost", "cancelled"].includes(proposal.status),
            ).length,
          ],
          ["Ganhas", won.length],
          [
            "Perdidas",
            proposals.filter((proposal) => proposal.status === "lost").length,
          ],
          ["Contratos ativos", active.length],
          [
            "Encerrados",
            contracts.filter((contract) =>
              ["expired", "terminated", "cancelled"].includes(contract.status),
            ).length,
          ],
          ["Documentos", docs.length],
          [
            "Parcelas vencidas",
            installments.filter((item) => item.status === "overdue").length,
          ],
        ].map(([label, value]) => (
          <article className="business-stat" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>
      <CenterTable
        title="Propostas"
        headers={[
          "Título",
          "Status",
          "Envio",
          "Setup",
          "Mensal",
          "Total",
          "Responsável",
        ]}
        rows={proposals.map((proposal) => [
          proposal.title,
          proposal.status,
          proposal.sent_at || "Não informado",
          proposal.setup_value == null
            ? "Não informado"
            : money(proposal.setup_value),
          proposal.monthly_value == null
            ? "Não informado"
            : money(proposal.monthly_value),
          proposal.total_value == null
            ? "Não informado"
            : money(proposal.total_value),
          proposal.responsible || "Sem responsável",
        ])}
      />
      <CenterTable
        title="Contratos"
        headers={[
          "Número",
          "Status",
          "Assinado",
          "Início",
          "Fim",
          "Setup contratado",
          "Setup recebido",
          "Mensal",
        ]}
        rows={contracts.map((contract) => [
          contract.contract_number || "Não informado",
          contract.status,
          contract.signed ? "Sim" : "Não",
          contract.start_date || "Não informado",
          contract.end_date || "Sem data final",
          contract.setup_value == null
            ? "Não informado"
            : money(contract.setup_value),
          money(contract.setup_received_amount),
          contract.monthly_value == null
            ? "Não informado"
            : money(contract.monthly_value),
        ])}
      />
      <CenterTable
        title="Serviços e responsáveis"
        headers={[
          "Serviço",
          "Status",
          "Escopo",
          "Entregas",
          "Comercial",
          "Entrega",
          "Acompanhamento",
          "Início",
          "Fim",
          "Valor",
        ]}
        rows={serviceRows}
      />
      <section className="dashboard-panel client-section">
        <h2>Documentos</h2>
        {docs.map((doc) => (
          <div className="document-row" key={doc.id}>
            <span>
              {doc.file_name}
              <small>
                {doc.document_type} · {String(doc.uploaded_at).slice(0, 10)}
              </small>
            </span>
            <button
              className="button secondary small"
              onClick={() => openDoc(doc)}
            >
              Abrir temporariamente
            </button>
          </div>
        ))}
        {!docs.length && <p className="data-note">Nenhum documento.</p>}
      </section>
      <CenterTable
        title="Financeiro"
        headers={[
          "Referência",
          "Vencimento",
          "Valor",
          "Status",
          "Pago em",
          "Forma de pagamento",
        ]}
        rows={installments.map((item) => [
          item.reference_month,
          item.due_date,
          money(item.amount),
          item.status,
          item.paid_at || "Não informado",
          item.payment_method || "Não informada",
        ])}
      />
      <CenterTable
        title="Histórico financeiro e comercial"
        headers={["Evento", "Título", "Data", "Descrição"]}
        rows={(client.commercial_events || []).map((event) => [
          event.event_type,
          event.title,
          String(event.created_at).slice(0, 16),
          event.description || "",
        ])}
      />
      <CenterTable
        title="Histórico de consolidações"
        headers={["Lote", "Data", "Motivo", "Registros movidos"]}
        rows={mergeHistory.map((batch) => [
          batch.id,
          String(batch.created_at).slice(0, 16),
          batch.reason,
          batch.data_merge_items?.length || 0,
        ])}
      />
      {whatsapp && (
        <WhatsAppReviewModal
          data={whatsapp}
          onClose={() => setWhatsapp(null)}
          onConfirm={({ phone }) =>
            recordBillingPrepared({
              clientId: whatsapp.clientId,
              contractId: whatsapp.contractId,
              description: `Cobrança preparada para ${phone}.`,
              newValue: {
                type: whatsapp.billingType,
                value: whatsapp.value,
                phone,
              },
            })
          }
        />
      )}
    </div>
  );
}

const storedFilters = () => {
  try {
    return JSON.parse(sessionStorage.getItem("mugo:client-filters")) || {};
  } catch {
    return {};
  }
};
export function ClientsPage() {
  const { canWrite } = useAuth(),
    initial = storedFilters();
  const [items, setItems] = useState([]),
    [query, setQuery] = useState(initial.query || ""),
    [status, setStatus] = useState(initial.status || "current"),
    [contractFilter, setContractFilter] = useState(
      initial.contractFilter || "all",
    ),
    [duplicateFilter, setDuplicateFilter] = useState(
      initial.duplicateFilter || "all",
    ),
    [sort, setSort] = useState(initial.sort || "updated-desc"),
    [form, setForm] = useState(empty),
    [editing, setEditing] = useState(null),
    [formOpen, setFormOpen] = useState(false),
    [selected, setSelected] = useState(null),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [busyId, setBusyId] = useState(null),
    [duplicateWarning, setDuplicateWarning] = useState([]),
    [override, setOverride] = useState(false),
    [justification, setJustification] = useState(""),
    savingRef = useRef(false);
  const load = () =>
    listClientsForReview()
      .then(setItems)
      .catch((cause) => setError(userError(cause)));
  useEffect(load, []);
  useEffect(() => {
    sessionStorage.setItem(
      "mugo:client-filters",
      JSON.stringify({ query, status, contractFilter, duplicateFilter, sort }),
    );
  }, [query, status, contractFilter, duplicateFilter, sort]);
  const groups = useMemo(() => groupPossibleDuplicateClients(items), [items]),
    duplicateIds = useMemo(
      () =>
        new Set(
          groups.flatMap((group) => group.members.map((item) => item.id)),
        ),
      [groups],
    ),
    rows = useMemo(
      () =>
        items.map((client) => {
          const activeContract = (client.contracts || []).find(
              (contract) =>
                contract.status === "active" && !contract.deleted_at,
            ),
            future = (activeContract?.invoice_installments || [])
              .filter((item) => !["paid", "cancelled"].includes(item.status))
              .sort((a, b) =>
                String(a.due_date).localeCompare(String(b.due_date)),
              )[0],
            incomplete =
              !client.contact_name ||
              !client.phone ||
              !client.email ||
              !client.document_number;
          return {
            ...client,
            activeContract,
            future,
            incomplete,
            isDuplicate: duplicateIds.has(client.id),
          };
        }),
      [items, duplicateIds],
    ),
    filtered = useMemo(
      () =>
        rows
          .filter(
            (client) =>
              (status === "all" ||
                (status === "current"
                  ? client.status !== "archived" && !client.deleted_at
                  : client.status === status)) &&
              (contractFilter === "all" ||
                (contractFilter === "active") ===
                  Boolean(client.activeContract)) &&
              (duplicateFilter === "all" ||
                (duplicateFilter === "yes") === client.isDuplicate) &&
              `${client.company_name} ${client.trade_name} ${client.document_number} ${client.contact_name} ${client.email} ${client.phone}`
                .toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .includes(
                  query
                    .toLowerCase()
                    .normalize("NFD")
                    .replace(/[\u0300-\u036f]/g, ""),
                ),
          )
          .sort((a, b) =>
            sort === "name"
              ? a.company_name.localeCompare(b.company_name, "pt-BR")
              : sort === "created-desc"
                ? String(b.created_at).localeCompare(String(a.created_at))
                : sort === "monthly-desc"
                  ? Number(b.activeContract?.monthly_value || 0) -
                    Number(a.activeContract?.monthly_value || 0)
                  : sort === "billing"
                    ? String(a.future?.due_date || "9999").localeCompare(
                        String(b.future?.due_date || "9999"),
                      )
                    : String(b.updated_at).localeCompare(String(a.updated_at)),
          ),
      [rows, status, contractFilter, duplicateFilter, query, sort],
    );
  if (selected)
    return <ClientCenter id={selected} onBack={() => setSelected(null)} />;
  function openForm(client = null) {
    setEditing(client?.id || null);
    setForm(client ? { ...empty, ...client } : empty);
    setDuplicateWarning([]);
    setOverride(false);
    setJustification("");
    setFormOpen(true);
  }
  function closeForm() {
    setFormOpen(false);
    setEditing(null);
    setForm(empty);
    setDuplicateWarning([]);
  }
  async function submit(event) {
    event.preventDefault();
    if (savingRef.current) return;
    const duplicates = findPossibleDuplicateClients(
      { ...form, id: editing },
      items,
    );
    if (!editing && duplicates.length && !override) {
      setDuplicateWarning(duplicates);
      return;
    }
    if (!editing && duplicates.length && !justification.trim()) {
      setError("Informe por que este cadastro representa outro cliente.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      editing
        ? await updateClient(editing, form)
        : await createClient({
            ...form,
            duplicate_override_confirmed: override,
            duplicate_justification: justification,
          });
      closeForm();
      await load();
    } catch (cause) {
      setDuplicateWarning(cause.matches || duplicates);
      setError(userError(cause));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  async function toggle(client) {
    if (busyId) return;
    setBusyId(client.id);
    try {
      client.status === "archived"
        ? await reactivateClient(client.id)
        : await archiveClient(client.id);
      await load();
    } catch (cause) {
      setError(userError(cause));
    } finally {
      setBusyId(null);
    }
  }
  const navigateDuplicates = (clientId) =>
    window.dispatchEvent(
      new CustomEvent("mugo:navigate", {
        detail: "client-duplicates",
        clientId,
      }),
    );
  return (
    <div className="clients-v2">
      <PageHeader
        eyebrow="Relacionamento comercial"
        title="Clientes"
        description="Cadastros, contratos e pendências em uma visão consolidada."
      />
      {dataProvider === "legacy" && (
        <FeedbackMessage type="info">
          Disponível após ativação da nova base de dados.
        </FeedbackMessage>
      )}
      {error && <FeedbackMessage type="error">{error}</FeedbackMessage>}
      <section className="client-summary-grid">
        {[
          ["Total", items.length],
          ["Ativos", items.filter((item) => item.status === "active").length],
          [
            "Inativos",
            items.filter((item) =>
              ["inactive", "former", "archived"].includes(item.status),
            ).length,
          ],
          ["Sem contrato", rows.filter((item) => !item.activeContract).length],
          ["Possíveis duplicidades", duplicateIds.size],
          ["Incompletos", rows.filter((item) => item.incomplete).length],
        ].map(([label, value]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>
      <section className="client-list-toolbar">
        <label className="client-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nome, contato, documento, e-mail ou telefone"
          />
        </label>
        <select
          aria-label="Status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="current">Atuais (sem arquivados)</option>
          <option value="all">Todos, incluindo arquivados</option>
          {["lead", "active", "inactive", "former", "archived"].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select
          aria-label="Contrato"
          value={contractFilter}
          onChange={(event) => setContractFilter(event.target.value)}
        >
          <option value="all">Todos os contratos</option>
          <option value="active">Com contrato ativo</option>
          <option value="none">Sem contrato ativo</option>
        </select>
        <select
          aria-label="Duplicidade"
          value={duplicateFilter}
          onChange={(event) => setDuplicateFilter(event.target.value)}
        >
          <option value="all">Todos</option>
          <option value="yes">Possível duplicidade</option>
          <option value="no">Sem alerta</option>
        </select>
        <select
          aria-label="Ordenação"
          value={sort}
          onChange={(event) => setSort(event.target.value)}
        >
          <option value="updated-desc">Atualização recente</option>
          <option value="created-desc">Criação recente</option>
          <option value="name">Nome</option>
          <option value="monthly-desc">Maior mensalidade</option>
          <option value="billing">Próxima cobrança</option>
        </select>
      </section>
      <section className="dashboard-panel client-list-primary">
        <header>
          <div>
            <h2>Clientes cadastrados</h2>
            <p>
              {filtered.length} de {items.length} cadastro(s)
            </p>
          </div>
          {duplicateIds.size > 0 && (
            <button
              className="button secondary"
              onClick={() => navigateDuplicates()}
            >
              Revisar {duplicateIds.size} alerta(s)
            </button>
          )}
        </header>
        <div className="client-table-desktop">
          <table className="report-table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Contato</th>
                <th>Status</th>
                <th>Contrato ativo</th>
                <th>Mensal</th>
                <th>Vencimento</th>
                <th>Pendências</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((client) => (
                <tr key={client.id}>
                  <td>
                    <button
                      className="table-link"
                      onClick={() => setSelected(client.id)}
                    >
                      {client.company_name}
                    </button>
                    <small>{client.trade_name || "Sem nome fantasia"}</small>
                  </td>
                  <td>
                    {client.contact_name || "Não informado"}
                    <small>{client.phone || "Sem telefone"}</small>
                  </td>
                  <td>{client.status}</td>
                  <td>
                    {client.activeContract?.contract_number || "Sem contrato"}
                  </td>
                  <td>
                    {client.activeContract
                      ? money(client.activeContract.monthly_value)
                      : "—"}
                  </td>
                  <td>{client.activeContract?.billing_day || "—"}</td>
                  <td>
                    {client.isDuplicate
                      ? "Possível duplicidade"
                      : client.incomplete
                        ? "Cadastro incompleto"
                        : "—"}
                  </td>
                  <td className="row-actions">
                    <button
                      className="button secondary small"
                      onClick={() => setSelected(client.id)}
                    >
                      Abrir
                    </button>
                    {client.isDuplicate && (
                      <button
                        className="button secondary small"
                        onClick={() => navigateDuplicates(client.id)}
                      >
                        Revisar
                      </button>
                    )}
                    {canWrite && (
                      <>
                        <button
                          className="button secondary small"
                          onClick={() => openForm(client)}
                        >
                          Editar
                        </button>
                        <button
                          className="button secondary small"
                          disabled={busyId === client.id}
                          onClick={() => toggle(client)}
                        >
                          {client.status === "archived"
                            ? "Restaurar"
                            : "Arquivar"}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="client-cards-mobile">
          {filtered.map((client) => (
            <article key={client.id}>
              <header>
                <div>
                  <strong>{client.company_name}</strong>
                  <span>{client.trade_name || client.status}</span>
                </div>
                <button
                  className="button secondary small"
                  onClick={() => setSelected(client.id)}
                >
                  Abrir
                </button>
              </header>
              <p>
                {client.contact_name || "Contato não informado"} ·{" "}
                {client.phone || "Sem telefone"}
              </p>
              <div>
                <span>
                  {client.activeContract
                    ? money(client.activeContract.monthly_value)
                    : "Sem contrato"}
                </span>
                <span>
                  Vencimento {client.activeContract?.billing_day || "—"}
                </span>
              </div>
              {client.isDuplicate && (
                <button
                  className="duplicate-alert-link"
                  onClick={() => navigateDuplicates(client.id)}
                >
                  Possível duplicidade — revisar
                </button>
              )}
            </article>
          ))}
        </div>
        {!filtered.length && (
          <div className="empty-state">
            Nenhum cliente corresponde aos filtros.
          </div>
        )}
      </section>
      {canWrite && (
        <div className="client-new-action">
          <button className="button" onClick={() => openForm()}>
            <Plus size={16} />
            Novo cliente
          </button>
        </div>
      )}
      {formOpen && (
        <>
          <button
            className="drawer-backdrop"
            aria-label="Fechar formulário"
            onClick={closeForm}
          />
          <aside
            className="client-form-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={editing ? "Editar cliente" : "Novo cliente"}
          >
            <header>
              <div>
                <small>Cadastro comercial</small>
                <h2>{editing ? "Editar cliente" : "Novo cliente"}</h2>
              </div>
              <button className="icon-button" onClick={closeForm}>
                <X size={20} />
              </button>
            </header>
            <form onSubmit={submit}>
              <div className="form-grid">
                {Object.keys(labels).map((key) => (
                  <label key={key}>
                    {labels[key]}
                    <input
                      type={
                        key.includes("email")
                          ? "email"
                          : key === "website"
                            ? "url"
                            : "text"
                      }
                      required={key === "company_name"}
                      value={form[key] || ""}
                      onChange={(event) =>
                        setForm({ ...form, [key]: event.target.value })
                      }
                    />
                  </label>
                ))}
                <label>
                  Status
                  <select
                    value={form.status}
                    onChange={(event) =>
                      setForm({ ...form, status: event.target.value })
                    }
                  >
                    {["lead", "active", "inactive", "former", "archived"].map(
                      (value) => (
                        <option key={value}>{value}</option>
                      ),
                    )}
                  </select>
                </label>
                <label className="full-width">
                  Observações
                  <textarea
                    value={form.notes}
                    onChange={(event) =>
                      setForm({ ...form, notes: event.target.value })
                    }
                  />
                </label>
              </div>
              {duplicateWarning.length > 0 && (
                <section className="duplicate-create-warning">
                  <strong>Encontramos possíveis correspondências</strong>
                  {duplicateWarning.map(({ client, comparison }) => (
                    <button
                      type="button"
                      key={client.id}
                      onClick={() => {
                        closeForm();
                        setSelected(client.id);
                      }}
                    >
                      <span>{client.company_name}</span>
                      <small>
                        {comparison.signals.join(" · ")} · confiança{" "}
                        {comparison.score}
                      </small>
                    </button>
                  ))}
                  {!editing && (
                    <>
                      <label>
                        <input
                          type="checkbox"
                          checked={override}
                          onChange={(event) =>
                            setOverride(event.target.checked)
                          }
                        />
                        Confirmo que se trata de outro cliente
                      </label>
                      <label>
                        Justificativa
                        <textarea
                          value={justification}
                          onChange={(event) =>
                            setJustification(event.target.value)
                          }
                          required={override}
                        />
                      </label>
                    </>
                  )}
                </section>
              )}
              <footer>
                <button
                  type="button"
                  className="button secondary"
                  onClick={closeForm}
                >
                  Cancelar
                </button>
                <button
                  className="button"
                  disabled={
                    saving ||
                    (!editing && duplicateWarning.length > 0 && !override)
                  }
                >
                  {saving ? "Salvando…" : "Salvar cliente"}
                </button>
              </footer>
            </form>
          </aside>
        </>
      )}
    </div>
  );
}
