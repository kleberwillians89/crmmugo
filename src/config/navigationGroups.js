import {
  CalendarDays,
  Columns3,
  MessageCircle,
  Settings2,
  WalletCards,
} from "lucide-react";

// CRM enxuto: cada grupo é UMA área no menu lateral; os links são as abas
// internas da área. Rotas técnicas continuam existindo (appRoutes.js), mas só
// aparecem em Configurações → Avançado, para administradores.
const OPERATORS = ["admin", "manager", "operations", "commercial"];
const FINANCE = ["admin", "manager", "finance"];
const MANAGERS = ["admin", "manager"];

export const NAVIGATION_GROUPS = [
  {
    id: "today",
    label: "Hoje",
    icon: CalendarDays,
    roles: OPERATORS,
    links: [
      { id: "operations-today", label: "Meu dia", supabaseOnly: true },
      { id: "operations-week", label: "Semana", supabaseOnly: true },
      { id: "operations-calendar", label: "Calendário", supabaseOnly: true },
      { id: "operations-backlog", label: "Backlog", supabaseOnly: true },
      { id: "operations-history", label: "Concluídos", supabaseOnly: true },
      { id: "dashboard", label: "Painel", roles: MANAGERS },
    ],
  },
  {
    id: "conversations",
    label: "Conversas",
    icon: MessageCircle,
    links: [
      { id: "inbox", label: "Caixa de entrada", supabaseOnly: true },
      { id: "templates", label: "Templates", supabaseOnly: true },
      { id: "automations", label: "Automações", supabaseOnly: true },
      { id: "whatsapp", label: "Canal WhatsApp", supabaseOnly: true, roles: MANAGERS },
    ],
  },
  {
    id: "commercial",
    label: "Comercial",
    icon: Columns3,
    links: [
      { id: "commercial", label: "Funil", supabaseOnly: true },
      { id: "prospecting", label: "Prospecção", supabaseOnly: true },
      { id: "email-campaigns", label: "E-mail marketing", supabaseOnly: true, roles: MANAGERS },
      { id: "proposals", label: "Propostas" },
      { id: "clients", label: "Clientes" },
      { id: "contacts", label: "Contatos", supabaseOnly: true },
      { id: "contracts", label: "Contratos" },
    ],
  },
  {
    id: "finance",
    label: "Financeiro",
    icon: WalletCards,
    roles: FINANCE,
    links: [
      { id: "finance-summary", label: "Visão geral" },
      { id: "finance-month", label: "Calendário" },
      { id: "finance", label: "Receitas" },
      { id: "accounts-payable", label: "Despesas" },
      { id: "collections", label: "Cobranças", supabaseOnly: true },
      { id: "monthly-closing", label: "Fechamento" },
    ],
  },
  {
    id: "settings",
    label: "Configurações",
    icon: Settings2,
    roles: MANAGERS,
    links: [
      { id: "ai-knowledge", label: "Base da IA", supabaseOnly: true },
      { id: "team", label: "Equipe", supabaseOnly: true, adminOnly: true },
      { id: "integrations", label: "Integrações", adminOnly: true },
      { id: "organization-settings", label: "Organização", adminOnly: true },
      { id: "advanced", label: "Avançado", adminOnly: true },
    ],
  },
];

// Páginas que não aparecem como aba, mas pertencem a uma área (para o menu
// destacar a área certa quando alguém abre um link direto).
const EXTRA_AREA_PAGES = {
  today: ["pulse-alerts", "intelligence-attention"],
  commercial: ["nova", "performance", "services", "documents", "commercial-trash", "commercial-integrity", "client-duplicates"],
  finance: [
    "financial-debts", "freelance-cash", "financial-goals", "accounting-export",
    "recurring-accounts", "cash-flow", "financial-reconciliation", "financial-reports",
    "client-contract-review", "finance-today", "finance-week", "financial-import",
    "financial-sanitation", "expense-categories", "cost-centers", "financial-accounts",
    "softwares", "providers", "bank-accounts", "cards",
  ],
  settings: ["system-audit", "crm-health", "backup", "restore", "diagnostic", "responsibilities"],
};

export function areaForPage(page) {
  if (!page) return null;
  for (const group of NAVIGATION_GROUPS) {
    if (group.links.some((link) => link.id === page)) return group.id;
    if ((EXTRA_AREA_PAGES[group.id] || []).includes(page)) return group.id;
  }
  if (page.startsWith("intelligence-")) return "today";
  return null;
}

export function canSee(item, { role, isLegacy = false, loading = false } = {}) {
  if (loading) return true;
  if (item.supabaseOnly && isLegacy) return false;
  if (item.adminOnly && role !== "admin") return false;
  if (item.roles && !item.roles.includes(role)) return false;
  return true;
}

export function visibleGroups(context) {
  return NAVIGATION_GROUPS.filter((group) => canSee(group, context))
    .map((group) => ({ ...group, links: group.links.filter((link) => canSee(link, context)) }))
    .filter((group) => group.links.length > 0);
}

// Ferramentas técnicas/manutenção: só em Configurações → Avançado.
export const ADVANCED_TOOLS = [
  { id: "crm-health", label: "Saúde do CRM", description: "Checagens de consistência dos dados." },
  { id: "system-audit", label: "Auditoria", description: "Histórico imutável de alterações sensíveis." },
  { id: "diagnostic", label: "Diagnóstico Supabase", description: "Conexão, permissões e migrations." },
  { id: "client-duplicates", label: "Clientes duplicados", description: "Revisar e mesclar cadastros repetidos." },
  { id: "financial-sanitation", label: "Saneamento financeiro", description: "Correções em lote de parcelas e contratos." },
  { id: "commercial-integrity", label: "Integridade comercial", description: "Propostas e contratos sem vínculo." },
  { id: "commercial-trash", label: "Lixeira", description: "Itens arquivados e exclusão definitiva." },
  { id: "financial-import", label: "Importação financeira", description: "Importar planilhas e extratos." },
  { id: "documents", label: "Importar documento", description: "Ler propostas e contratos em PDF." },
  { id: "services", label: "Catálogo de serviços", description: "Serviços usados em propostas." },
  { id: "expense-categories", label: "Categorias de despesa", description: "Plano de contas." },
  { id: "cost-centers", label: "Centros de custo", description: "Agrupamento de despesas." },
  { id: "financial-accounts", label: "Contas financeiras", description: "Bancos e carteiras." },
  { id: "pulse-alerts", label: "Alertas Pulse", description: "Alertas automáticos de operação." },
  { id: "intelligence-attention", label: "Mugô Intelligence", description: "Análises e insights (experimental)." },
  { id: "backup", label: "Backup", description: "Exportar todos os dados." },
  { id: "restore", label: "Restauração", description: "Restaurar a partir de backup." },
];
