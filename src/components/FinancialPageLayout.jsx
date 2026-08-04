export function FinancialPageLayout({ children, active, onNavigate }) {
  const tabs = [
    ["finance-summary", "Dashboard"],
    ["finance", "A receber"],
    ["accounts-payable", "A pagar"],
    ["recurring-accounts", "Recorrentes"],
    ["cash-flow", "Fluxo de caixa"],
    ["financial-reconciliation", "Conciliação"],
    ["financial-reports", "Relatórios"],
    ["accounting-export", "Contabilidade"],
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
