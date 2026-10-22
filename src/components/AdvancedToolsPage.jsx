import { ArrowRight, Wrench } from 'lucide-react'
import { ADVANCED_TOOLS } from '../config/navigationGroups'
import { PageHeader } from './PageHeader'

export function AdvancedToolsPage({ onNavigate }) {
  return (
    <div className="advanced-tools-page">
      <PageHeader
        eyebrow="Configurações"
        title="Avançado"
        description="Ferramentas de manutenção e diagnóstico. Use com cuidado — algumas alteram dados em lote."
      />
      <section className="advanced-tools-grid">
        {ADVANCED_TOOLS.map((tool) => (
          <button type="button" key={tool.id} className="advanced-tool" onClick={() => onNavigate(tool.id)}>
            <Wrench size={16} aria-hidden="true" />
            <div>
              <strong>{tool.label}</strong>
              <small>{tool.description}</small>
            </div>
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        ))}
      </section>
    </div>
  )
}
