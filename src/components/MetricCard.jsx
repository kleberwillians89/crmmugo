function formatCurrency(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '-'
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 2,
  }).format(number)
}

export function MetricCard({ title, value, icon: Icon, items = [], itemValueKey, tone = 'neutral' }) {
  const visibleItems = items.slice(0, 8)
  const extraCount = items.length - visibleItems.length

  return (
    <article className={`metric-card metric-card-${tone}`}>
      <div>
        <span>{title}</span>
        <strong>{value}</strong>
      </div>
      {Icon && <Icon size={20} />}
      <div className="metric-card-tooltip">
        <div className="metric-card-tooltip-header">
          <strong>{title}</strong>
          <span>{items.length} clientes</span>
        </div>
        {items.length ? (
          <div className="metric-card-tooltip-list">
            {visibleItems.map((item) => (
              <div key={item.id ?? item.client_name} className="metric-card-tooltip-item">
                <div>
                  <strong>{item.client_name || 'Sem cliente'}</strong>
                  <span>{item.main_service || 'Serviço não informado'}</span>
                </div>
                <div>
                  <span>{item.status || 'Sem status'}</span>
                  {itemValueKey ? (
                    <strong>{formatCurrency(item[itemValueKey])}</strong>
                  ) : null}
                </div>
              </div>
            ))}
            {extraCount > 0 && <div className="metric-card-tooltip-excess">+ {extraCount} clientes</div>}
          </div>
        ) : (
          <div className="metric-card-tooltip-empty">Nenhum cliente encontrado</div>
        )}
      </div>
    </article>
  )
}
