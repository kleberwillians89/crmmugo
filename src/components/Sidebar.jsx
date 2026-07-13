import {
  Building2,
  ChevronLeft,
  ClipboardCheck,
  FileText,
  Library,
  LayoutDashboard,
  Plus,
  Settings,
  X,
} from 'lucide-react'

const groups = [
  { label: 'Visão geral', links: [{ id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }] },
  {
    label: 'Comercial',
    links: [
      { id: 'nova', label: 'Nova proposta', icon: Plus },
      { id: 'proposals', label: 'Propostas', icon: FileText },
      { id: 'contracts', label: 'Contratos', icon: ClipboardCheck },
      { id: 'services', label: 'Serviços e preços', icon: Library },
    ],
  },
  { label: 'Sistema', links: [{ id: 'settings', label: 'Configurações', icon: Settings, disabled: true }] },
]

export function Sidebar({ activePage, onNavigate, open, collapsed, onClose, onToggleCollapse }) {
  function navigate(id) {
    onNavigate(id)
    onClose()
  }

  return (
    <>
      <button
        type="button"
        className={open ? 'sidebar-backdrop visible' : 'sidebar-backdrop'}
        onClick={onClose}
        aria-label="Fechar menu"
        tabIndex={open ? 0 : -1}
      />
      <aside className={`sidebar${open ? ' open' : ''}${collapsed ? ' collapsed' : ''}`}>
      <div className="brand-panel">
        <div className="brand-mark" aria-hidden="true">M</div>
        <div className="brand-copy">
          <strong>Mugô CRM</strong>
          <p>Inteligência comercial</p>
        </div>
        <button type="button" className="sidebar-close" onClick={onClose} aria-label="Fechar menu">
          <X size={20} />
        </button>
      </div>
      <nav className="sidebar-nav">
        {groups.map((group) => (
          <div className="nav-group" key={group.label}>
            <p className="nav-group-label">{group.label}</p>
            {group.links.map((link) => {
              const Icon = link.icon
              return (
                <button
                  key={link.id}
                  type="button"
                  className={`nav-item${activePage === link.id ? ' active' : ''}`}
                  onClick={() => navigate(link.id)}
                  disabled={link.disabled}
                  title={collapsed ? link.label : undefined}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>{link.label}</span>
                  {link.disabled && <small>Em breve</small>}
                </button>
              )
            })}
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="agency-avatar"><Building2 size={17} /></div>
        <div className="brand-copy">
          <strong>Agência Mugô</strong>
          <small>Workspace comercial</small>
        </div>
      </div>
      <button type="button" className="collapse-button" onClick={onToggleCollapse} aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}>
        <ChevronLeft size={17} />
        <span>Recolher menu</span>
      </button>
    </aside>
    </>
  )
}
