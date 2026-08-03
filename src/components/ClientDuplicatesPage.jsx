import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Eye, ShieldCheck } from "lucide-react";
import {
  assistedConsolidationPlans,
  planClientIds,
  SNAPSHOT_ORGANIZATION_ID,
} from "../lib/assistedConsolidationPlans";
import {
  clientCompleteness,
  groupPossibleDuplicateClients,
} from "../lib/clientDeduplication";
import {
  getClient,
  listClientsForReview,
} from "../services/data/clientsRepository";
import { previewClientMerge } from "../services/data/clientMergeRepository";
import { listConversationLinks } from "../services/data/whatsappClientLinksRepository";
import { FeedbackMessage } from "./FeedbackMessage";
import { PageHeader } from "./PageHeader";

const money = (value) =>
  value == null
    ? "Não informado"
    : new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }).format(Number(value));
const futureInstallments = (client, contractId) => {
  const today = new Date().toISOString().slice(0, 10);
  return (client?.invoice_installments || []).filter(
    (row) => row.contract_id === contractId && row.due_date >= today,
  );
};
const paidEvidence = (row) =>
  Boolean(
    row.paid_at || Number(row.received_amount || row.paid_amount || 0) > 0,
  );

export function ClientDuplicatesPage() {
  const [clients, setClients] = useState([]),
    [links, setLinks] = useState([]),
    [details, setDetails] = useState([]),
    [selected, setSelected] = useState(null),
    [preview, setPreview] = useState(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    Promise.all([
      listClientsForReview(),
      listConversationLinks().catch(() => []),
    ])
      .then(([rows, whatsapp]) => {
        setClients(rows);
        setLinks(whatsapp);
      })
      .catch((cause) =>
        setError(
          cause.message || "Não foi possível carregar a auditoria por RLS.",
        ),
      )
      .finally(() => setLoading(false));
  }, []);
  const groups = useMemo(
    () => groupPossibleDuplicateClients(clients),
    [clients],
  );
  const involved = new Set(
    groups.flatMap((group) => group.members.map((row) => row.id)),
  );
  const archived = clients.filter(
    (row) => row.status === "archived" || row.deleted_at,
  );
  async function inspect(plan) {
    setSelected(plan);
    setPreview(null);
    setError("");
    try {
      setDetails(await Promise.all(planClientIds(plan).map(getClient)));
    } catch (cause) {
      setDetails([]);
      setError(
        cause.message || "Não foi possível carregar os vínculos deste plano.",
      );
    }
  }
  async function readPreview() {
    try {
      setPreview(
        await previewClientMerge(selected.primaryId, selected.secondaryIds),
      );
    } catch (cause) {
      setError(
        cause.message || "O preview somente leitura não pôde ser gerado.",
      );
    }
  }
  const contract = details
    .flatMap((row) => row.contracts || [])
    .find((row) => row.id === selected?.contractId);
  const future = details.flatMap((row) =>
    futureInstallments(row, selected?.contractId),
  );
  const futurePaid = future.filter(paidEvidence);
  return (
    <div>
      <PageHeader
        eyebrow="Administração · somente leitura"
        title="Auditoria e consolidação assistida"
        description="Snapshot real e dados visíveis pela sessão autenticada. Nenhuma alteração é executada nesta tela."
      />
      {error && <FeedbackMessage type="error">{error}</FeedbackMessage>}
      <section className="duplicate-summary">
        <article>
          <span>Clientes visíveis por RLS</span>
          <strong>{clients.length}</strong>
        </article>
        <article>
          <span>Grupos suspeitos</span>
          <strong>{groups.length}</strong>
        </article>
        <article>
          <span>Cadastros envolvidos</span>
          <strong>{involved.size}</strong>
        </article>
        <article>
          <span>Arquivados</span>
          <strong>{archived.length}</strong>
        </article>
      </section>
      <FeedbackMessage type="info">
        Modo de preparação: preview permitido; consolidação, atualização
        contratual e geração de parcelas estão desativadas.
      </FeedbackMessage>
      <section className="duplicate-groups">
        {assistedConsolidationPlans.map((plan) => {
          const found = clients.filter((row) =>
            planClientIds(plan).includes(row.id),
          );
          return (
            <article key={plan.key}>
              <header>
                <div>
                  <strong>{plan.label}</strong>
                  <span>
                    {plan.kind === "merge"
                      ? "Consolidação preparada"
                      : plan.kind === "contract-change"
                        ? "Mudança contratual"
                        : plan.kind === "decision"
                          ? "Decisão pendente"
                          : "Em definição"}{" "}
                    · confiança {plan.confidence}
                  </span>
                </div>
                <button
                  className="button secondary small"
                  onClick={() => inspect(plan)}
                >
                  <Eye size={15} />
                  Revisar
                </button>
              </header>
              <div>
                <small>
                  {found.length}/{planClientIds(plan).length} cadastro(s)
                  localizados
                </small>
                <small>
                  Atual: {money(plan.currentMonthly)} · dia{" "}
                  {plan.currentBillingDay ?? "pendente"}
                </small>
                <small>
                  Informado: {money(plan.proposedMonthly)} · dia{" "}
                  {plan.proposedBillingDay ?? "pendente"}
                </small>
              </div>
              <footer>
                {found.map((row) => (
                  <span key={row.id}>
                    {row.company_name} · {row.status}
                    {row.deleted_at ? " · deleted_at" : ""}
                  </span>
                ))}
              </footer>
            </article>
          );
        })}
      </section>
      {loading ? (
        <p>Carregando dados reais…</p>
      ) : (
        groups.length === 0 && (
          <div className="empty-state">
            <CheckCircle2 />
            Nenhum grupo adicional atingiu o limiar automático.
          </div>
        )
      )}
      {selected && (
        <section className="merge-workspace">
          <header>
            <div>
              <small>Plano {selected.label}</small>
              <h2>Preview assistido — nenhuma escrita disponível</h2>
            </div>
            <button
              className="button secondary"
              onClick={() => {
                setSelected(null);
                setDetails([]);
                setPreview(null);
              }}
            >
              Fechar
            </button>
          </header>
          {details.map((client) => (
            <article className="dashboard-panel" key={client.id}>
              <h3>{client.company_name}</h3>
              <p>
                {client.id} · {client.status} · completude{" "}
                {clientCompleteness(client)} · criado{" "}
                {String(client.created_at || "").slice(0, 10)} · atualizado{" "}
                {String(client.updated_at || "").slice(0, 10)}
              </p>
              <p>
                {(client.contracts || []).length} contrato(s) ·{" "}
                {(client.proposals || []).length} proposta(s) ·{" "}
                {(client.invoice_installments || []).length} parcela(s) ·{" "}
                {(client.documents || []).length} documento(s) ·{" "}
                {(client.commercial_events || []).length} evento(s) ·{" "}
                {links.filter((link) => link.client_id === client.id).length}{" "}
                vínculo(s) WhatsApp
              </p>
            </article>
          ))}
          <section className="merge-impact">
            <h3>Contrato e parcelas potencialmente afetadas</h3>
            <div>
              <span>
                Contrato:{" "}
                {contract?.id || selected.contractId || "não definido"}
              </span>
              <span>
                Mensal atual:{" "}
                {money(contract?.monthly_value ?? selected.currentMonthly)}
              </span>
              <span>
                Vencimento atual: dia{" "}
                {contract?.billing_day ??
                  selected.currentBillingDay ??
                  "pendente"}
              </span>
              <span>Mensal informado: {money(selected.proposedMonthly)}</span>
              <span>
                Vencimento informado: dia{" "}
                {selected.proposedBillingDay ?? "pendente"}
              </span>
              <span>Parcelas futuras: {future.length}</span>
              <span>
                Futuras com evidência de pagamento: {futurePaid.length}
              </span>
            </div>
            {future.map((row) => (
              <p key={row.id}>
                <strong>{row.reference_month}</strong> · vence {row.due_date} ·{" "}
                {money(row.amount)} · status {row.status} · recebido{" "}
                {money(row.received_amount ?? row.paid_amount ?? 0)} ·
                idempotência {row.idempotency_key || "ausente"}{" "}
                {paidEvidence(row) ? "· PRESERVAR" : ""}
              </p>
            ))}
            {selected.requiresStartDate && (
              <FeedbackMessage type="warning">
                Competência/data inicial precisa ser definida antes de qualquer
                alteração futura.
              </FeedbackMessage>
            )}
            {selected.notes.map((note) => (
              <p key={note}>• {note}</p>
            ))}
          </section>
          {selected.kind === "merge" && (
            <button className="button secondary" onClick={readPreview}>
              <ShieldCheck size={16} />
              Gerar preview RPC somente leitura
            </button>
          )}
          {preview && (
            <section className="dashboard-panel">
              <h3>Preview retornado pelo banco</h3>
              <p>
                Organização:{" "}
                {preview.organization_id || SNAPSHOT_ORGANIZATION_ID}
              </p>
              <div className="merge-counts">
                {Object.entries(preview.counts || {}).map(([table, count]) => (
                  <span key={table}>
                    {table}: {count}
                  </span>
                ))}
              </div>
              <p>Nenhuma operação foi executada.</p>
            </section>
          )}
        </section>
      )}
    </div>
  );
}
