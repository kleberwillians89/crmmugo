import { Building2, ChevronLeft, LogOut, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { MugoBrand } from './brand/MugoBrand'
import { statusLabel } from '../config/statusLabels'
import { NAVIGATION_GROUPS, areaForPage, visibleGroups } from '../config/navigationGroups'

// Menu enxuto: uma entrada por área. As sub-páginas aparecem como abas no topo
// da área (SectionTabs / abas próprias de WhatsApp e Financeiro).
export function Sidebar({ activePage, onNavigate, open, collapsed, onClose, onToggleCollapse }) {
  const { isLegacy, signOut, profile, loading: profileLoading } = useAuth()
  const groups = visibleGroups({ role: profile?.role, isLegacy, loading: profileLoading })
  const activeArea = areaForPage(activePage)
  function navigate(group) {
    onNavigate(group.links[0].id)
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
        <MugoBrand variant={collapsed ? 'symbol' : 'full'} theme="dark" />
        <button type="button" className="sidebar-close" onClick={onClose} aria-label="Fechar menu">
          <X size={20} />
        </button>
      </div>
      <nav className="sidebar-nav" aria-label="Áreas do CRM">
        <div className="nav-group">
          {groups.map((group) => {
            const Icon = group.icon
            return (
              <button
                key={group.id}
                type="button"
                className={`nav-item${activeArea === group.id ? ' active' : ''}`}
                aria-current={activeArea === group.id ? 'page' : undefined}
                onClick={() => navigate(group)}
                title={collapsed ? group.label : undefined}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{group.label}</span>
              </button>
            )
          })}
        </div>
      </nav>
      <div className="sidebar-footer">
        <div className="agency-avatar"><Building2 size={17} /></div>
        <div className="brand-copy">
          <strong>{profile?.name || 'Agência Mugô'}</strong>
          <small>{profile?.role ? statusLabel('role',profile.role) : 'Ambiente comercial'}</small>
        </div>
      </div>
      {!isLegacy && <button type="button" className="collapse-button" onClick={signOut}><LogOut size={17} /><span>Sair</span></button>}
      <button type="button" className="collapse-button" onClick={onToggleCollapse} aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}>
        <ChevronLeft size={17} />
        <span>Recolher menu</span>
      </button>
    </aside>
    </>
  )
}

export { NAVIGATION_GROUPS }
