export function FinancialPageLayout({ children, active, onNavigate }) {
  const tabs = [
    ["finance-summary", "Visão Geral"],
    ["finance-month", "Calendário"],
    ["finance", "Receitas"],
    ["accounts-payable", "Despesas"],
    ["financial-debts", "Dívidas"],
    ["freelance-cash", "Caixa Freela"],
    ["financial-goals", "Metas & Reservas"],
    ["monthly-closing", "Fechamento mensal"],
    ["accounting-export", "Exportar para contador"],
  ];
  return (
    <div className="financial-layout">
      <nav className="section-tabs" aria-label="Navegação financeira">
        {tabs.map(([id, label]) => (
          <button
            type="button"
            key={id}
            className={active === id ? "active" : ""}
            onClick={() => onNavigate?.(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {children}
    </div>
  );
}
