import { LayoutDashboard, PlusCircle, FileText, ClipboardCheck } from 'lucide-react'

const links = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'nova', label: 'Nova Proposta', icon: PlusCircle },
  { id: 'proposals', label: 'Propostas', icon: FileText },
  { id: 'contracts', label: 'Contratos', icon: ClipboardCheck },
]

export function Sidebar({ activePage, onNavigate }) {
  return (
    <aside className="sidebar">
      <div className="brand-panel">
        <div className="brand-mark">M</div>
        <div>
          <strong>Mugô Agência</strong>
          <p>CRM interno</p>
        </div>
      </div>
      <nav className="sidebar-nav">
        {links.map((link) => {
          const Icon = link.icon
          return (
            <button
              key={link.id}
              type="button"
              className={activePage === link.id ? 'nav-item active' : 'nav-item'}
              onClick={() => onNavigate(link.id)}
            >
              <Icon size={18} />
              <span>{link.label}</span>
            </button>
          )
        })}
      </nav>
      <div className="sidebar-footer">
        <p>Marca: Mugô</p>
        <small>Relatório comercial interno</small>
      </div>
    </aside>
  )
}
