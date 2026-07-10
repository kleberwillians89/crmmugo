function currency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

export function ProposalsSummary({ metrics }) {
  const items = [
    ['Propostas', metrics.count],
    ['Valor exibido', currency(metrics.total)],
    ['Receita mensal', currency(metrics.monthly)],
    ['Fechadas', metrics.closed],
    ['Em negociação', metrics.negotiating],
  ]

  return <section className="proposals-summary" aria-label="Resumo das propostas filtradas">
    {items.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
  </section>
}
