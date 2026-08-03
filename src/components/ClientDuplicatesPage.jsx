import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Eye, ShieldCheck } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
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
import {
  executeClientMerge,
  listClientMergeHistory,
  previewClientMerge,
} from "../services/data/clientMergeRepository";
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
  const { canWrite, profile, session } = useAuth();
  const [clients, setClients] = useState([]),
    [links, setLinks] = useState([]),
    [history, setHistory] = useState([]),
    [details, setDetails] = useState([]),
    [selected, setSelected] = useState(null),
    [preview, setPreview] = useState(null),
    [error, setError] = useState(""),
    [reason, setReason] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [understood, setUnderstood] = useState(false),
    [executing, setExecuting] = useState(false),
    [result, setResult] = useState(null),
    [decisionDraft, setDecisionDraft] = useState({}),
    [requestKey, setRequestKey] = useState(() => crypto.randomUUID()),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    Promise.all([
      listClientsForReview(),
      listConversationLinks().catch(() => []),
      listClientMergeHistory().catch(() => []),
    ])
      .then(([rows, whatsapp, batches]) => {
        setClients(rows);
        setLinks(whatsapp);
        setHistory(batches);
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
  const completedPlan = (key) => {
      const plan = assistedConsolidationPlans.find((item) => item.key === key);
      return Boolean(
        plan &&
        history.some(
          (batch) =>
            batch.status === "completed" &&
            batch.primary_client_id === plan.primaryId &&
            plan.secondaryIds.every((id) =>
              batch.secondary_client_ids?.includes(id),
            ),
        ),
      );
    },
    executionAllowed = Boolean(
      selected?.kind === "merge" &&
      !completedPlan(selected.key) &&
      (selected.key === "origami" ||
        (selected.key === "amalie" && completedPlan("origami")) ||
        (selected.key === "roove" && completedPlan("amalie"))),
    );
  async function inspect(plan) {
    setSelected(plan);
    setPreview(null);
    setError("");
    setReason("");
    setConfirmation("");
    setUnderstood(false);
    setResult(null);
    setDecisionDraft({});
    setRequestKey(crypto.randomUUID());
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
    if (!session?.user) {
      setError("Entre no CRM para gerar o preview pela sessão autenticada.");
      return;
    }
    if (!canWrite) {
      setError(
        `O papel ${profile?.role || "não identificado"} possui somente leitura. O preview exige admin ou manager autorizado por can_write().`,
      );
      return;
    }
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
  async function executeSelected() {
    if (
      !executionAllowed ||
      !preview ||
      !understood ||
      reason.trim().length < 10
    )
      return;
    const primaryBefore = details.find((row) => row.id === selected.primaryId),
      secondaryBefore = details.find((row) =>
        selected.secondaryIds.includes(row.id),
      ),
      paidBefore = details
        .flatMap((row) => row.invoice_installments || [])
        .filter(paidEvidence)
        .map((row) => ({
          id: row.id,
          amount: row.amount,
          received_amount: row.received_amount,
          paid_at: row.paid_at,
          status: row.status,
        }));
    if (!primaryBefore || !secondaryBefore)
      return setError(
        "Os dois cadastros precisam estar carregados antes da execução.",
      );
    if (confirmation !== primaryBefore.company_name)
      return setError("O nome digitado não corresponde ao cliente principal.");
    if (
      (selected.currentMonthly != null &&
        Number(contract?.monthly_value) !== Number(selected.currentMonthly)) ||
      (selected.currentBillingDay != null &&
        Number(contract?.billing_day) !== Number(selected.currentBillingDay))
    )
      return setError(
        "Os dados atuais do contrato não correspondem ao snapshot aprovado. Execução bloqueada.",
      );
    const selectedFields = {
      company_name: primaryBefore.company_name,
      trade_name: primaryBefore.trade_name,
      contact_name: primaryBefore.contact_name,
      document_number: primaryBefore.document_number,
      email: primaryBefore.email,
      phone: ["origami", "roove"].includes(selected.key)
        ? secondaryBefore.phone || primaryBefore.phone
        : primaryBefore.phone,
      website: primaryBefore.website,
      instagram: primaryBefore.instagram,
      segment: primaryBefore.segment,
      lead_source: primaryBefore.lead_source,
      status: primaryBefore.status,
      notes: primaryBefore.notes,
      billing_contact_name: primaryBefore.billing_contact_name,
      billing_contact_email: primaryBefore.billing_contact_email,
      billing_contact_phone: primaryBefore.billing_contact_phone,
      billing_contact_role: primaryBefore.billing_contact_role,
      primary_responsible_id: primaryBefore.primary_responsible_id,
    };
    setExecuting(true);
    setError("");
    try {
      const batchId = await executeClientMerge({
        requestKey,
        primaryId: selected.primaryId,
        secondaryIds: selected.secondaryIds,
        selectedFields,
        reason: reason.trim(),
        confirmationName: confirmation,
        approvedPreview: preview,
      });
      const [primaryAfter, secondaryAfter, history] = await Promise.all([
        getClient(selected.primaryId),
        getClient(selected.secondaryIds[0]),
        listClientMergeHistory(),
      ]);
      const batch = history.find((row) => row.id === batchId),
        allAfter = primaryAfter.invoice_installments || [],
        paidPreserved = paidBefore.every((before) => {
          const after = allAfter.find((row) => row.id === before.id);
          return (
            after &&
            Number(after.amount) === Number(before.amount) &&
            Number(after.received_amount || 0) ===
              Number(before.received_amount || 0) &&
            after.paid_at === before.paid_at &&
            after.status === before.status
          );
        }),
        contractPreserved = (primaryAfter.contracts || []).some(
          (row) =>
            row.id === selected.contractId &&
            (selected.currentMonthly == null ||
              Number(row.monthly_value) === Number(selected.currentMonthly)) &&
            (selected.currentBillingDay == null ||
              Number(row.billing_day) === Number(selected.currentBillingDay)),
        );
      setResult({
        batchId,
        primaryId: primaryAfter.id,
        secondaryId: secondaryAfter.id,
        secondaryArchived:
          secondaryAfter.status === "archived" &&
          Boolean(secondaryAfter.deleted_at),
        paidPreserved,
        contractPreserved,
        items: batch?.data_merge_items || [],
      });
      setClients(await listClientsForReview());
      setHistory(history);
    } catch (cause) {
      setError(
        cause.message || "A transação falhou e foi revertida integralmente.",
      );
    } finally {
      setExecuting(false);
    }
  }
  const contract = details
    .flatMap((row) => row.contracts || [])
    .find((row) => row.id === selected?.contractId);
  const primary = details.find((row) => row.id === selected?.primaryId);
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
        Ordem controlada: Origami → validação → Amalie → validação → Roove.
        Gabi, Curavino, Santo Circuito e os demais leads permanecem bloqueados.
      </FeedbackMessage>
      <section className="dashboard-panel merge-auth-status">
        <h2>Autorização do preview</h2>
        <p>
          Sessão: {session?.user ? "autenticada" : "não autenticada"} · Papel
          atual: {profile?.role || "não identificado"} · Permissão:{" "}
          {canWrite ? "preview autorizado" : "somente leitura"}.
        </p>
        <small>
          O preview usa o token da sessão atual pelo cliente Supabase e respeita
          RLS. Nenhum token é exibido ou armazenado nesta página.
        </small>
      </section>
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
          {selected.kind === "merge" && !completedPlan(selected.key) && (
            <button
              className="button secondary"
              disabled={!session?.user || !canWrite}
              onClick={readPreview}
            >
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
          {selected.kind === "merge" && preview && !result && (
            <section className="merge-confirmation">
              <h3>Confirmação forte — lote exclusivo {selected.label}</h3>
              {!executionAllowed && (
                <FeedbackMessage type="warning">
                  Este lote aguarda a conclusão e validação da etapa anterior.
                </FeedbackMessage>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={understood}
                  onChange={(event) => setUnderstood(event.target.checked)}
                />
                Entendo que somente os vínculos do secundário serão movidos e
                que ele será arquivado sem exclusão.
              </label>
              <label>
                Motivo
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Descreva a evidência e a decisão (mínimo 10 caracteres)"
                />
              </label>
              <label>
                Digite exatamente “{primary?.company_name}”
                <input
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
              <button
                className="button danger"
                disabled={
                  !executionAllowed ||
                  !canWrite ||
                  executing ||
                  !understood ||
                  reason.trim().length < 10 ||
                  confirmation !== primary?.company_name
                }
                onClick={executeSelected}
              >
                {executing
                  ? "Executando transação…"
                  : `Consolidar somente ${selected.label}`}
              </button>
            </section>
          )}
          {selected.kind !== "merge" && (
            <FeedbackMessage type="info">
              Execução bloqueada. Este caso exige decisão ou complementação de
              dados.
            </FeedbackMessage>
          )}
          {selected.key === "gabi" && (
            <section className="dashboard-panel">
              <h3>Decisão empresarial obrigatória</h3>
              {[
                "A. GIMPORTS permanece cliente e Gabriela vira contato/representante",
                "B. Consolidar os registros",
              ].map((option) => (
                <label key={option}>
                  <input
                    type="radio"
                    name="gabi-decision"
                    checked={decisionDraft.gabi === option}
                    onChange={() =>
                      setDecisionDraft({ ...decisionDraft, gabi: option })
                    }
                  />
                  {option}
                </label>
              ))}
              <label>
                Data inicial da mensalidade de R$ 5.000,00
                <input
                  type="date"
                  value={decisionDraft.gabiStart || ""}
                  onChange={(event) =>
                    setDecisionDraft({
                      ...decisionDraft,
                      gabiStart: event.target.value,
                    })
                  }
                />
              </label>
              <p>
                Vencimento dia 10 · recorrência mensal · contrato ativo. O
                preview deve atingir somente parcelas futuras a partir da
                competência escolhida.
              </p>
              <button
                className="button secondary"
                disabled={!decisionDraft.gabi || !decisionDraft.gabiStart}
              >
                Preview financeiro — disponível no fluxo específico de alteração
                contratual
              </button>
              <p>
                Escolha registrada apenas nesta tela. Nenhuma atualização será
                enviada.
              </p>
            </section>
          )}
          {selected.key === "curavino" && (
            <section className="dashboard-panel">
              <h3>Novo contrato prospectivo</h3>
              <label>
                Data inicial obrigatória
                <input
                  type="date"
                  value={decisionDraft.curavinoStart || ""}
                  onChange={(event) =>
                    setDecisionDraft({
                      ...decisionDraft,
                      curavinoStart: event.target.value,
                    })
                  }
                />
              </label>
              <p>
                R$ 1.500,00 · vencimento dia 7. O contrato histórico e suas
                parcelas permanecem intactos.
              </p>
              <button
                className="button secondary"
                disabled={!decisionDraft.curavinoStart}
              >
                Preview do novo contrato — disponível em etapa posterior
              </button>
            </section>
          )}
          {selected.key === "santo-circuito" && (
            <section className="dashboard-panel">
              <h3>Campos necessários antes da ativação</h3>
              <p>Guga · R$ 5.500,00 mensais · vencimento proposto dia 15.</p>
              <label>
                Data inicial
                <input
                  type="date"
                  value={decisionDraft.santoStart || ""}
                  onChange={(event) =>
                    setDecisionDraft({
                      ...decisionDraft,
                      santoStart: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                Serviços incluídos
                <input
                  value={decisionDraft.santoServices || ""}
                  onChange={(event) =>
                    setDecisionDraft({
                      ...decisionDraft,
                      santoServices: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                Contratante correto
                <input
                  value={decisionDraft.santoContractor || ""}
                  onChange={(event) =>
                    setDecisionDraft({
                      ...decisionDraft,
                      santoContractor: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                Contato e dados financeiros
                <input
                  value={decisionDraft.santoFinancial || ""}
                  onChange={(event) =>
                    setDecisionDraft({
                      ...decisionDraft,
                      santoFinancial: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(decisionDraft.santoDueConfirmed)}
                  onChange={(event) =>
                    setDecisionDraft({
                      ...decisionDraft,
                      santoDueConfirmed: event.target.checked,
                    })
                  }
                />
                Confirmo vencimento dia 15.
              </label>
              <button
                className="button secondary"
                disabled={
                  !decisionDraft.santoStart ||
                  !decisionDraft.santoServices ||
                  !decisionDraft.santoContractor ||
                  !decisionDraft.santoFinancial ||
                  !decisionDraft.santoDueConfirmed
                }
              >
                Preview de contrato — disponível em etapa posterior
              </button>
              <p>Nenhum contrato ou parcela será criado por este formulário.</p>
            </section>
          )}
          {selected.key === "akana" && (
            <section className="dashboard-panel">
              <h3>Lead incompleto</h3>
              <p>
                Completar contato, e-mail, telefone, documento e próxima ação
                antes de qualquer contrato ou receita.
              </p>
              <button className="button secondary" disabled>
                Manter como lead
              </button>
            </section>
          )}
          {completedPlan(selected.key) && (
            <FeedbackMessage type="success">
              Este plano já possui lote concluído e não pode ser repetido como
              nova execução.
            </FeedbackMessage>
          )}
          {result && (
            <section className="dashboard-panel">
              <h3>Validação pós-consolidação</h3>
              <p>Lote: {result.batchId}</p>
              <p>Principal: {result.primaryId}</p>
              <p>
                Secundário: {result.secondaryId} ·{" "}
                {result.secondaryArchived
                  ? "arquivado"
                  : "INCONSISTÊNCIA: não arquivado"}
              </p>
              <p>
                Contrato R$ 1.500/dia 7:{" "}
                {result.contractPreserved ? "preservado" : "INCONSISTÊNCIA"}
              </p>
              <p>
                Parcelas pagas e recebimentos:{" "}
                {result.paidPreserved ? "preservados" : "INCONSISTÊNCIA"}
              </p>
              <div className="merge-counts">
                {Object.entries(
                  result.items.reduce(
                    (acc, item) => ({
                      ...acc,
                      [item.table_name]: (acc[item.table_name] || 0) + 1,
                    }),
                    {},
                  ),
                ).map(([table, count]) => (
                  <span key={table}>
                    {table}: {count}
                  </span>
                ))}
              </div>
            </section>
          )}
        </section>
      )}
    </div>
  );
}
