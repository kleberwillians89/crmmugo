function currency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

export function ProposalsSummary({ metrics }) {
  const items = [
    ['Propostas enviadas', metrics.sent],
    ['Valor total enviado', currency(metrics.sentValue)],
    ['Fechadas', metrics.closed],
    ['Valor total fechado', currency(metrics.closedValue)],
    ['Perdidas', metrics.lost],
    ['Valor perdido', currency(metrics.lostValue)],
    ['Conversão por desfecho', `${metrics.outcomeConversion.toFixed(1)}%`],
    ['Conversão sobre enviadas', `${metrics.sentConversion.toFixed(1)}%`],
    ['Ticket médio enviado', currency(metrics.sent ? metrics.sentValue / metrics.sent : 0)],
    ['Ticket médio fechado', currency(metrics.closed ? metrics.closedValue / metrics.closed : 0)],
  ]

  return <section className="proposals-summary conversion-summary" aria-label="Resumo das propostas filtradas">
    {items.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
  </section>
}
