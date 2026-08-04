import assert from "node:assert/strict";
import fs from "node:fs";
import {
  accountingCsv,
  financialDashboard,
  uniqueById,
} from "../src/lib/financialProduction.js";

const receivables = [
  {
    id: "r1",
    reference_month: "2026-08-01",
    amount: 5000,
    received_amount: 3000,
    status: "partial",
  },
  {
    id: "r1",
    reference_month: "2026-08-01",
    amount: 5000,
    received_amount: 3000,
    status: "partial",
  },
  {
    id: "r2",
    reference_month: "2026-09-01",
    amount: 1500,
    received_amount: 0,
    status: "pending",
  },
];
const payables = [
  {
    id: "p1",
    reference_month: "2026-08-01",
    amount: 120,
    business_amount: 120,
    paid_amount: 120,
    status: "paid",
    expenses: { name: "Software", scope: "business" },
  },
  {
    id: "p2",
    reference_month: "2026-08-01",
    amount: 1000,
    business_amount: 0,
    paid_amount: 0,
    status: "pending",
    expenses: { name: "Revisar", scope: "pending_review" },
  },
];

assert.equal(uniqueById(receivables).length, 2);
const summary = financialDashboard(receivables, payables, "2026-08");
assert.equal(summary.revenue, 5000);
assert.equal(summary.received, 3000);
assert.equal(summary.expense, 120);
assert.equal(summary.cashFlow, 2880);
assert.equal(summary.operatingResult, 4880);
const csv = accountingCsv(receivables, payables, "2026-08");
assert.match(csv, /Competência/);
assert.match(csv, /Software/);
assert.doesNotMatch(csv, /Revisar/);

const routes = fs.readFileSync(
  new URL("../src/config/appRoutes.js", import.meta.url),
  "utf8",
);
const page = fs.readFileSync(
  new URL("../src/components/FinancialProductionPages.jsx", import.meta.url),
  "utf8",
);
for (const route of [
  "softwares",
  "providers",
  "bank-accounts",
  "cards",
  "accounting-export",
])
  assert.match(routes, new RegExp(`\\b${route.replace("-", "\\-")}`));
for (const rpcRisk of ["service_role", ".delete(", "execute_client_merge"])
  assert.equal(page.includes(rpcRisk), false);

console.log("CRM V3 production polish: ok");
