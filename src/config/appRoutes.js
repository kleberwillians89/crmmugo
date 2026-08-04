export const APP_ROUTES = {
  dashboard: "/",
  proposals: "/propostas",
  nova: "/propostas/nova",
  contracts: "/contratos",
  clients: "/clientes",
  services: "/servicos",
  whatsapp: "/whatsapp",
  "pulse-alerts": "/alertas",
  documents: "/documentos",
  team: "/equipe",
  responsibilities: "/responsabilidades",
  finance: "/financeiro",
  "finance-summary": "/financeiro/resumo",
  "accounts-payable": "/financeiro/contas-a-pagar",
  "recurring-accounts": "/financeiro/recorrentes",
  "cash-flow": "/financeiro/fluxo-de-caixa",
  "financial-reconciliation": "/financeiro/conciliacao",
  "financial-reports": "/financeiro/relatorios",
  "accounting-export": "/financeiro/exportar-contabilidade",
  "client-contract-review": "/financeiro/revisao-clientes",
  "organization-settings": "/configuracoes",
  "expense-categories": "/configuracoes/categorias",
  "cost-centers": "/configuracoes/centros-de-custo",
  "financial-accounts": "/configuracoes/contas-financeiras",
  softwares: "/administracao/softwares",
  providers: "/administracao/prestadores",
  "bank-accounts": "/administracao/contas-bancarias",
  cards: "/administracao/cartoes",
  "financial-import": "/administracao/importacao-financeira",
  "intelligence-today": "/intelligence/hoje",
  "intelligence-attention": "/intelligence/atencao",
  "intelligence-insights": "/intelligence/insights",
  "intelligence-recommendations": "/intelligence/recomendacoes",
  "intelligence-trends": "/intelligence/tendencias",
  "intelligence-cross-analysis": "/intelligence/analise-cruzada",
  "intelligence-health": "/intelligence/saude",
  "intelligence-ai": "/intelligence/ia",
  "system-audit": "/administracao/auditoria",
  backup: "/administracao/backup",
  restore: "/administracao/restauracao",
  diagnostic: "/administracao/diagnostico",
  "crm-health": "/administracao/saude",
  "client-duplicates": "/administracao/duplicidades-clientes",
  "financial-sanitation": "/administracao/saneamento-financeiro",
  "monthly-closing": "/financeiro/fechamento-mensal",
};

export const ROUTE_ALIASES = {
  "/financeiro/receber": "finance",
  "/financeiro/contas-a-receber": "finance",
  "/contas-a-receber": "finance",
  "/importar": "documents",
  "/alertas-pendencias": "pulse-alerts",
  "/auditoria": "system-audit",
  "/backup": "backup",
  "/restauracao": "restore",
  "/diagnostico": "diagnostic",
};

const routePages = Object.fromEntries(
  Object.entries(APP_ROUTES).map(([page, path]) => [path, page]),
);

export function pageFromPath(pathname = window.location.pathname) {
  const path = pathname.replace(/\/$/, "") || "/";
  return routePages[path] || ROUTE_ALIASES[path] || "not-found";
}

export const pathForPage = (page) => APP_ROUTES[page];
