import { Search, SlidersHorizontal, X } from 'lucide-react'

export function ProposalsToolbar({ filters, options, activeCount, onChange, onClear }) {
  return <section className="proposals-toolbar" aria-label="Busca e filtros de propostas">
    <div className="proposal-search">
      <Search size={17} aria-hidden="true" />
      <label className="sr-only" htmlFor="proposal-search">Buscar propostas</label>
      <input id="proposal-search" type="search" value={filters.search} onChange={(event) => onChange('search', event.target.value)} placeholder="Buscar cliente, empresa, serviço..." />
      {filters.search && <button type="button" onClick={() => onChange('search', '')} aria-label="Limpar busca"><X size={16} /></button>}
    </div>
    <div className="filter-row">
      <div className="filter-heading"><SlidersHorizontal size={16} /><span>Filtros</span>{activeCount > 0 && <strong>{activeCount}</strong>}</div>
      <label><span>Status</span><select value={filters.status} onChange={(e) => onChange('status', e.target.value)}><option value="">Todos</option>{options.statuses.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label><span>Responsável</span><select value={filters.responsible} onChange={(e) => onChange('responsible', e.target.value)}><option value="">Todos</option>{options.responsibles.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label><span>Serviço</span><select value={filters.service} onChange={(e) => onChange('service', e.target.value)}><option value="">Todos</option>{options.services.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label><span>Contrato</span><select value={filters.signed} onChange={(e) => onChange('signed', e.target.value)}><option value="">Todos</option><option value="signed">Assinado</option><option value="pending">Pendente</option><option value="unknown">Não informado</option></select></label>
      <label><span>Prazo</span><select value={filters.term} onChange={(e) => onChange('term', e.target.value)}><option value="">Todos</option>{options.terms.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label><span>Enviada a partir de</span><input type="date" value={filters.sentFrom} onChange={(e) => onChange('sentFrom', e.target.value)} /></label>
      <label><span>Enviada até</span><input type="date" value={filters.sentTo} onChange={(e) => onChange('sentTo', e.target.value)} /></label>
      <label><span>Ordenar</span><select value={filters.sort} onChange={(e) => onChange('sort', e.target.value)}><option value="recent">Mais recente</option><option value="oldest">Mais antiga</option><option value="highest">Maior valor</option><option value="lowest">Menor valor</option><option value="az">Cliente A-Z</option><option value="za">Cliente Z-A</option><option value="status">Status</option></select></label>
      {activeCount > 0 && <button type="button" className="clear-filters" onClick={onClear}>Limpar filtros</button>}
    </div>
  </section>
}
