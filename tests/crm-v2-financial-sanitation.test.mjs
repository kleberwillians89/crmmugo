import assert from "node:assert/strict";
import {
  accountingStandards,
  buildClientSanitationRows,
  buildSanitationAudit,
  businessExpenseAmount,
  classifyReceivable,
  duplicateContractGroups,
  duplicateInstallmentGroups,
  hasPaymentEvidence,
} from "../src/lib/financialSanitation.js";

const TODAY = "2026-08-31";

// hasPaymentEvidence
assert.equal(hasPaymentEvidence({ received_amount: 100 }), true);
assert.equal(hasPaymentEvidence({ paid_amount: 0, paid_at: "2026-01-10" }), true);
assert.equal(hasPaymentEvidence({ received_amount: 0 }), false);
assert.equal(hasPaymentEvidence({}), false);

// classifyReceivable — cada ramo
assert.equal(
  classifyReceivable({ due_date: "2026-12-01", status: "paid" }, TODAY).key,
  "future_paid",
);
assert.equal(
  classifyReceivable({ due_date: "2026-05-01", status: "paid" }, TODAY).key,
  "proof_required",
);
assert.equal(
  classifyReceivable({ due_date: "2026-05-01", status: "pending" }, TODAY).key,
  "overdue",
);
assert.equal(
  classifyReceivable({ due_date: "2026-05-01", status: "cancelled" }, TODAY).key,
  "confirmed",
);
assert.equal(
  classifyReceivable({ due_date: "2026-12-01", status: "pending" }, TODAY).key,
  "future",
);
assert.equal(
  classifyReceivable(
    { due_date: "2026-05-01", status: "paid", received_amount: 500 },
    TODAY,
  ).key,
  "confirmed",
);
assert.equal(classifyReceivable({ due_date: "2026-12-01" }, TODAY).review, false);

// duplicateInstallmentGroups
const dupInstallments = duplicateInstallmentGroups([
  { id: "1", idempotency_key: "k1", amount: 100 },
  { id: "2", idempotency_key: "k1", amount: 100 },
  {
    id: "3",
    client_id: "c",
    contract_id: "ct",
    reference_month: "2026-08-01",
    due_date: "2026-08-10",
    amount: 200,
    installment_number: 1,
  },
  {
    id: "4",
    client_id: "c",
    contract_id: "ct",
    reference_month: "2026-08-01",
    due_date: "2026-08-10",
    amount: 200,
    installment_number: 1,
  },
  { id: "5", idempotency_key: "unique", amount: 999 },
]);
assert.equal(dupInstallments.length, 2);
assert.deepEqual(
  dupInstallments.map((g) => g.items.length).sort(),
  [2, 2],
);
const keyGroup = dupInstallments.find((g) => g.key === "key:k1");
assert.equal(keyGroup.amount, 200);

// duplicateContractGroups — usa o mapa de clientes candidatos para colapsar duplicados
const contractShape = {
  monthly_value: 5000,
  billing_day: 10,
  start_date: "2026-01-01",
  end_date: null,
  status: "active",
  contract_services: [{ service_name: "Social Media" }],
};
const dupContracts = duplicateContractGroups(
  [
    { id: "a", client_id: "primary", ...contractShape },
    { id: "b", client_id: "secondary", ...contractShape },
    { id: "c", client_id: "primary", ...contractShape, monthly_value: 1 },
  ],
  new Map([["secondary", "primary"]]),
);
assert.equal(dupContracts.length, 1);
assert.deepEqual(
  dupContracts[0].items.map((r) => r.id).sort(),
  ["a", "b"],
);

// businessExpenseAmount
assert.equal(
  businessExpenseAmount({ expenses: { scope: "business" }, amount: 300 }),
  300,
);
assert.equal(
  businessExpenseAmount({
    expenses: { scope: "shared" },
    amount: 300,
    business_amount: 120,
  }),
  120,
);
assert.equal(
  businessExpenseAmount({ expenses: { scope: "personal" }, amount: 300 }),
  0,
);

// buildSanitationAudit
const audit = buildSanitationAudit({
  clients: [
    { id: "c1", contact_name: "A", phone: "1", email: "a@x.com", document_number: "1", contracts: [{ status: "active" }] },
    { id: "c2", contracts: [] },
  ],
  contracts: [{ id: "k1", status: "active", monthly_value: 5000, billing_day: 10, contract_services: [{ service_name: "x" }] }],
  receivables: [
    { id: "r1", amount: 1000, status: "paid", due_date: "2026-01-10", received_amount: 1000 },
    { id: "r2", amount: 2000, status: "paid", due_date: "2026-12-10" },
  ],
  payables: [
    { expenses: { scope: "business" }, amount: 400 },
    { expenses: { scope: "shared" }, amount: 400, business_amount: 100 },
  ],
  expenses: [{ total_amount: 0, scope: "personal" }],
  duplicateGroups: [],
});
assert.ok(Array.isArray(audit.checklist.clients));
assert.ok(Array.isArray(audit.checklist.contracts));
assert.ok(Array.isArray(audit.checklist.finance));
assert.ok(Array.isArray(audit.checklist.expenses));
assert.equal(audit.confirmedRevenue, 1000);
assert.equal(audit.reviewRevenue, 2000);
assert.equal(audit.businessExpenses, 500);
assert.equal(audit.underReview.length, 1);
assert.equal(audit.confirmed.length, 1);

// buildClientSanitationRows
const rows = buildClientSanitationRows(
  [
    {
      id: "ready",
      company_name: "Ready LTDA",
      document_number: "1",
      contact_name: "Ana",
      phone: "1",
      email: "a@x.com",
      status: "active",
      billing_contact_name: "Ana",
      billing_contact_email: "fin@x.com",
      contracts: [
        {
          id: "ct",
          status: "active",
          monthly_value: 5000,
          billing_day: 10,
          deleted_at: null,
          invoice_installments: [],
        },
      ],
    },
    { id: "incomplete", company_name: "X", status: "lead", contracts: [] },
    { id: "archived", company_name: "Old", status: "archived", contracts: [] },
  ],
  [],
);
const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
assert.equal(byId.ready.readyForAccountant, true);
assert.equal(byId.ready.classification, "pronto");
assert.equal(byId.incomplete.classification, "completar informações");
assert.equal(byId.incomplete.readyForAccountant, false);
assert.equal(byId.archived.classification, "arquivado");

// accountingStandards
assert.ok(accountingStandards.revenue.includes("Mensalidades"));
assert.ok(accountingStandards.expense.includes("Impostos e taxas"));
assert.ok(accountingStandards.costCenters.includes("Compartilhado"));

console.log("CRM V2 financial sanitation: ok");
