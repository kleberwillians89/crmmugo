import assert from "node:assert/strict";
import fs from "node:fs";
import { NAVIGATION_GROUPS } from "../src/config/navigationGroups.js";

const visible = NAVIGATION_GROUPS.flatMap((group) =>
  group.links.map((link) => link.id),
);
// Navegação por domínios (Attio/Linear-like): grupos nomeados, não uma lista plana.
assert.deepEqual(
  NAVIGATION_GROUPS.map((group) => group.id),
  ["overview", "crm", "communication", "finance", "administration"],
);
for (const required of [
  "dashboard",
  "clients",
  "contacts",
  "contracts",
  "inbox",
  "automations",
  "templates",
  "whatsapp",
  "finance-summary",
  "collections",
  "organization-settings",
])
  assert.ok(visible.includes(required), `item de navegação ausente: ${required}`);
// nenhuma rota técnica/administrativa profunda vazou para o menu principal
for (const hidden of ["softwares", "system-audit", "financial-sanitation", "monthly-closing"])
  assert.equal(visible.includes(hidden), false, `rota técnica não deve estar no menu: ${hidden}`);

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
