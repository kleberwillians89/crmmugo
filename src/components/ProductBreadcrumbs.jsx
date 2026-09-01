import { ChevronRight } from "lucide-react";

const BREADCRUMBS = {
  dashboard: ["Visão geral", "Dashboard"],
  clients: ["CRM", "Clientes"],
  contacts: ["CRM", "Contatos"],
  contracts: ["CRM", "Contratos"],
  inbox: ["Comunicação", "Caixa de entrada"],
  automations: ["Comunicação", "Automações"],
  templates: ["Comunicação", "Templates"],
  whatsapp: ["Comunicação", "WhatsApp"],
  "finance-summary": ["Financeiro", "Visão financeira"],
  finance: ["Financeiro", "Contas a receber"],
  "accounts-payable": ["Financeiro", "Contas a pagar"],
  collections: ["Financeiro", "Cobranças"],
  integrations: ["Administração", "Integrações"],
  "organization-settings": ["Administração", "Configurações"],
};

export function ProductBreadcrumbs({ page, compact = false }) {
  const items = BREADCRUMBS[page];
  if (!items) return null;
  return (
    <nav className={`product-breadcrumbs${compact ? " compact" : ""}`} aria-label="Navegação estrutural">
      {items.map((item, index) => (
        <span key={item}>
          {index > 0 && <ChevronRight size={12} aria-hidden="true" />}
          <span aria-current={index === items.length - 1 ? "page" : undefined}>{item}</span>
        </span>
      ))}
    </nav>
  );
}
