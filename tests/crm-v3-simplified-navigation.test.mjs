import assert from "node:assert/strict";
import fs from "node:fs";
import { NAVIGATION_GROUPS } from "../src/config/navigationGroups.js";

const visible = NAVIGATION_GROUPS.flatMap((group) =>
  group.links.map((link) => link.id),
);
assert.deepEqual(visible, [
  "dashboard",
  "clients",
  "contracts",
  "whatsapp",
  "finance-summary",
  "organization-settings",
]);
assert.equal(visible.length, 6);

const routes = fs.readFileSync(
  new URL("../src/config/appRoutes.js", import.meta.url),
  "utf8",
);
for (const hiddenRoute of [
  "softwares",
  "providers",
  "bank-accounts",
  "cards",
  "expense-categories",
  "cost-centers",
  "system-audit",
  "financial-sanitation",
])
  assert.ok(routes.includes(hiddenRoute), `Rota preservada: ${hiddenRoute}`);

const finance = fs.readFileSync(
  new URL("../src/components/FinancialPageLayout.jsx", import.meta.url),
  "utf8",
);
for (const tab of [
  "Resumo",
  "Contas a receber",
  "Contas a pagar",
  "Fluxo de caixa",
  "Fechamento mensal",
  "Exportar para contador",
])
  assert.ok(finance.includes(tab));
for (const hiddenTab of ["Recorrentes", "Conciliação", "Relatórios"])
  assert.equal(finance.includes(hiddenTab), false);

const dashboard = fs.readFileSync(
  new URL("../src/components/Dashboard.jsx", import.meta.url),
  "utf8",
);
for (const card of [
  "Receita prevista",
  "Receita recebida",
  "Receita vencida",
  "Contas a pagar",
  "Resultado operacional",
  "Próximos recebimentos",
  "Próximas despesas",
  "Clientes ativos",
  "Alertas importantes",
])
  assert.ok(dashboard.includes(card));

console.log("CRM V3 simplified navigation: ok");
