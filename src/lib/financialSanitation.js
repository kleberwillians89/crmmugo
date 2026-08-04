const num = (value) => Number(value || 0);
const dateOnly = (value) => String(value || "").slice(0, 10);
export const hasPaymentEvidence = (row) =>
  num(row.received_amount ?? row.paid_amount) > 0 || Boolean(row.paid_at);
export function classifyReceivable(
  row,
  today = new Date().toISOString().slice(0, 10),
) {
  const future = dateOnly(row.due_date) > today,
    evidence = hasPaymentEvidence(row),
    paid = row.status === "paid";
  if (future && paid)
    return {
      key: "future_paid",
      label: "Futura marcada como paga",
      review: true,
    };
  if (paid && !evidence)
    return {
      key: "proof_required",
      label: "Precisa de comprovação",
      review: true,
    };
  if (
    dateOnly(row.due_date) < today &&
    !evidence &&
    !["cancelled", "refunded"].includes(row.status)
  )
    return { key: "overdue", label: "Vencida", review: true };
  if (future) return { key: "future", label: "Futura", review: false };
  return { key: "confirmed", label: "Confirmada", review: false };
}
const normalized = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
export function duplicateInstallmentGroups(rows = []) {
  const map = new Map();
  rows.forEach((row) => {
    const key = row.idempotency_key
      ? `key:${row.idempotency_key}`
      : `fields:${row.client_id}|${row.contract_id}|${dateOnly(row.reference_month)}|${dateOnly(row.due_date)}|${num(row.amount).toFixed(2)}|${row.installment_number ?? ""}`;
    map.set(key, [...(map.get(key) || []), row]);
  });
  return [...map.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([key, items]) => ({
      key,
      items,
      amount: items.reduce((sum, row) => sum + num(row.amount), 0),
    }));
}
export function duplicateContractGroups(
  contracts = [],
  candidateClientIds = new Map(),
) {
  const map = new Map();
  contracts.forEach((row) => {
    const client = candidateClientIds.get(row.client_id) || row.client_id,
      key = [
        client,
        num(row.monthly_value).toFixed(2),
        row.billing_day || "",
        dateOnly(row.start_date),
        dateOnly(row.end_date),
        row.status,
        row.proposal_id || "",
        row.legacy_id || "",
        (row.contract_services || [])
          .map((s) => normalized(s.service_name))
          .sort()
          .join("|"),
      ].join("::");
    map.set(key, [...(map.get(key) || []), row]);
  });
  return [...map.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([key, items]) => ({ key, items }));
}
export function businessExpenseAmount(row) {
  if (row.expenses?.scope === "business") return num(row.amount);
  if (row.expenses?.scope === "shared") return num(row.business_amount);
  return 0;
}
export function buildSanitationAudit({
  clients = [],
  contracts = [],
  receivables = [],
  payables = [],
  expenses = [],
  duplicateGroups = [],
}) {
  const duplicateClientIds = new Map();
  duplicateGroups.forEach((group) =>
    group.members.forEach((row) => duplicateClientIds.set(row.id, group.id)),
  );
  const suspectContracts = duplicateContractGroups(
      contracts,
      duplicateClientIds,
    ),
    suspectInstallments = duplicateInstallmentGroups(receivables);
  const classifications = receivables.map((row) => ({
      ...row,
      classification: classifyReceivable(row),
    })),
    suspectIds = new Set(
      suspectInstallments.flatMap((group) => group.items.map((row) => row.id)),
    );
  const underReview = classifications.filter(
      (row) => row.classification.review || suspectIds.has(row.id),
    ),
    confirmed = classifications.filter(
      (row) => !row.classification.review && !suspectIds.has(row.id),
    );
  const activeContracts = contracts.filter(
    (row) => row.status === "active" && !row.deleted_at,
  );
  const checklist = {
    clients: [
      ["Duplicidades pendentes", duplicateGroups.length],
      [
        "Clientes incompletos",
        clients.filter((r) => !r.contact_name || !r.phone || !r.email).length,
      ],
      [
        "Sem contato financeiro",
        clients.filter(
          (r) =>
            !r.billing_contact_name &&
            !r.billing_contact_phone &&
            !r.billing_contact_email,
        ).length,
      ],
      ["Sem documento", clients.filter((r) => !r.document_number).length],
      [
        "Sem contrato",
        clients.filter((r) => !(r.contracts || []).length).length,
      ],
      [
        "Arquivados com contrato ativo",
        clients.filter(
          (r) =>
            (r.status === "archived" || r.deleted_at) &&
            (r.contracts || []).some(
              (c) => c.status === "active" && !c.deleted_at,
            ),
        ).length,
      ],
    ],
    contracts: [
      ["Contratos ativos", activeContracts.length],
      [
        "Vencidos ainda ativos",
        activeContracts.filter(
          (r) =>
            r.end_date &&
            dateOnly(r.end_date) < new Date().toISOString().slice(0, 10),
        ).length,
      ],
      [
        "Sem valor",
        contracts.filter((r) => !num(r.monthly_value) && !num(r.setup_value))
          .length,
      ],
      ["Sem vencimento", activeContracts.filter((r) => !r.billing_day).length],
      [
        "Sem serviços",
        contracts.filter((r) => !(r.contract_services || []).length).length,
      ],
      ["Possíveis duplicados", suspectContracts.length],
    ],
    finance: [
      [
        "Parcelas vencidas",
        classifications.filter((r) => r.classification.key === "overdue")
          .length,
      ],
      [
        "Parcelas pendentes",
        receivables.filter((r) => r.status === "pending").length,
      ],
      [
        "Pagas sem comprovação",
        classifications.filter((r) => r.classification.key === "proof_required")
          .length,
      ],
      [
        "Futuras marcadas pagas",
        classifications.filter((r) => r.classification.key === "future_paid")
          .length,
      ],
      ["Sem contrato", receivables.filter((r) => !r.contract_id).length],
      ["Potencialmente repetidas", suspectInstallments.length],
      ["Valores sob revisão", underReview.length],
    ],
    expenses: [
      ["Sem valor", expenses.filter((r) => !num(r.total_amount)).length],
      ["Sem vencimento", expenses.filter((r) => !r.due_day).length],
      ["Sem categoria", expenses.filter((r) => !r.category_id).length],
      ["Sem centro de custo", expenses.filter((r) => !r.cost_center_id).length],
      [
        "Pessoais separadas",
        expenses.filter((r) => r.scope === "personal").length,
      ],
      [
        "Compartilhadas sem percentual",
        expenses.filter(
          (r) => r.scope === "shared" && !num(r.business_percentage),
        ).length,
      ],
      [
        "Recorrentes não validadas",
        expenses.filter((r) => r.recurrence_type !== "once" && !r.validated)
          .length,
      ],
    ],
  };
  return {
    checklist,
    suspectContracts,
    suspectInstallments,
    classifications,
    underReview,
    confirmed,
    confirmedRevenue: confirmed.reduce((s, r) => s + num(r.amount), 0),
    reviewRevenue: underReview.reduce((s, r) => s + num(r.amount), 0),
    businessExpenses: payables.reduce(
      (s, r) => s + businessExpenseAmount(r),
      0,
    ),
  };
}

const clientDecisions = {
  "744dd494-5eed-4429-b432-9c8f407be37c": "decisão necessária",
  "de129d57-976f-42b6-a0a2-bafe7d16df13": "decisão necessária",
  "35b06647-a6e2-4c8d-803a-f394ea890d4f": "revisar contrato",
  "6a25e024-0781-4cf1-a225-cd739bf34ef4": "manter como lead",
  "0244338f-08ac-4d32-856e-56edf556d653": "manter como lead",
};
export function buildClientSanitationRows(clients = [], duplicateGroups = []) {
  const duplicateIds = new Set(
    duplicateGroups.flatMap((group) => group.members.map((row) => row.id)),
  );
  return clients.map((client) => {
    const contracts = client.contracts || [],
      activeContract = contracts.find(
        (row) => row.status === "active" && !row.deleted_at,
      ),
      installments = contracts.flatMap((row) => row.invoice_installments || []),
      open = installments.filter(
        (row) =>
          !["cancelled", "refunded"].includes(row.status) &&
          num(row.amount) > num(row.received_amount),
      ),
      next = open
        .filter(
          (row) =>
            dateOnly(row.due_date) >= new Date().toISOString().slice(0, 10),
        )
        .sort((a, b) =>
          dateOnly(a.due_date).localeCompare(dateOnly(b.due_date)),
        )[0],
      incomplete =
        !client.company_name ||
        !client.document_number ||
        !client.contact_name ||
        !client.phone ||
        !client.email,
      financialReview = installments.some(
        (row) => classifyReceivable(row).review,
      ),
      contractReview = Boolean(
        activeContract &&
        (!num(activeContract.monthly_value) || !activeContract.billing_day),
      ),
      archived = client.status === "archived" || Boolean(client.deleted_at),
      duplicate = duplicateIds.has(client.id),
      explicit = clientDecisions[client.id];
    let classification = "pronto";
    if (archived) classification = "arquivado";
    else if (explicit) classification = explicit;
    else if (duplicate) classification = "consolidar duplicidade";
    else if (financialReview) classification = "revisar financeiro";
    else if (contractReview) classification = "revisar contrato";
    else if (incomplete) classification = "completar informações";
    else if (["lead", "opportunity"].includes(client.status))
      classification = "manter como lead";
    const readyForAccountant = Boolean(
      !archived &&
      !duplicate &&
      !incomplete &&
      !financialReview &&
      !contractReview &&
      client.billing_contact_name &&
      (client.billing_contact_phone || client.billing_contact_email) &&
      (client.status !== "active" || activeContract),
    );
    return {
      ...client,
      activeContract,
      nextInstallment: next,
      openAmount: open.reduce(
        (sum, row) =>
          sum + Math.max(num(row.amount) - num(row.received_amount), 0),
        0,
      ),
      duplicate,
      incomplete,
      classification,
      readyForAccountant,
      recommendedAction:
        classification === "pronto"
          ? "Manter cadastro revisado"
          : classification === "arquivado"
            ? "Manter fora dos ativos"
            : classification === "manter como lead"
              ? "Completar dados antes de ativar"
              : "Abrir revisão assistida",
    };
  });
}

export const accountingStandards = {
  revenue: [
    "Mensalidades",
    "Projetos",
    "Desenvolvimento",
    "Sites e e-commerce",
    "CRM e sistemas",
    "Tráfego pago",
    "Social media",
    "Consultoria",
    "Registro de marca",
    "Inteligência artificial",
    "Automação",
    "Outros serviços",
  ],
  expense: [
    "Inteligência artificial",
    "Design",
    "Infraestrutura",
    "Hospedagem",
    "E-mail e armazenamento",
    "Desenvolvimento",
    "Prestadores",
    "Equipe",
    "Marketing",
    "Contabilidade",
    "Impostos e taxas",
    "Telefonia",
    "Internet",
    "Transporte",
    "Equipamentos",
    "Domínios",
    "Serviços bancários",
    "Outros",
  ],
  costCenters: [
    "Diretoria",
    "Administrativo",
    "Financeiro",
    "Comercial",
    "Marketing",
    "Tecnologia",
    "Operação",
    "Pessoas",
    "Projetos",
    "Compartilhado",
    "Pessoal",
  ],
};
