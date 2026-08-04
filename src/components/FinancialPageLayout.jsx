export function FinancialPageLayout({ children, active, onNavigate }) {
  const tabs = [
    ["finance-summary", "Resumo"],
    ["finance", "Contas a receber"],
    ["accounts-payable", "Contas a pagar"],
    ["cash-flow", "Fluxo de caixa"],
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
