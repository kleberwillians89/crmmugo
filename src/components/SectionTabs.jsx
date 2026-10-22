import { useAuth } from '../contexts/AuthContext'
import { NAVIGATION_GROUPS, areaForPage, visibleGroups } from '../config/navigationGroups'

// Áreas cujas páginas já desenham as próprias abas.
const SELF_TABBED = new Set(['conversations', 'finance'])

export function SectionTabs({ page, onNavigate, force = false }) {
  const { isLegacy, profile, loading } = useAuth()
  const area = areaForPage(page)
  if (!area || (!force && SELF_TABBED.has(area))) return null
  const group = visibleGroups({ role: profile?.role, isLegacy, loading }).find((item) => item.id === area)
  if (!group || group.links.length < 2) return null
  return (
    <nav className="section-tabs area-tabs" aria-label={`Navegação de ${group.label}`}>
      {group.links.map((link) => (
        <button
          type="button"
          key={link.id}
          className={page === link.id ? 'active' : ''}
          aria-current={page === link.id ? 'page' : undefined}
          onClick={() => page !== link.id && onNavigate(link.id)}
        >
          {link.label}
        </button>
      ))}
    </nav>
  )
}

export { NAVIGATION_GROUPS }
