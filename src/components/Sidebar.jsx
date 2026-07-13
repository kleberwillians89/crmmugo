import {
  Building2,
  BrainCircuit,
  ChevronLeft,
  ClipboardCheck,
  FileText,
  Library,
  Users,
  UserRoundCog,
  WalletCards,
  Upload,
  LogOut,
  Activity,
  SlidersHorizontal,
  LayoutDashboard,
  Plus,
  Settings,
  Trash2,
  ShieldCheck,
  X,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { MugoBrand } from './brand/MugoBrand'
import { NAVIGATION_LABELS } from '../config/navigationLabels'
import { statusLabel } from '../config/statusLabels'

const groups = [
  { label: 'Visão geral', links: [{ id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }, { id: 'intelligence', label: 'Mugô Intelligence', icon: BrainCircuit }] },
  {
    label: 'Comercial',
    links: [
      { id: 'nova', label: 'Nova proposta', icon: Plus },
      { id: 'proposals', label: 'Propostas', icon: FileText },
      { id: 'performance', label: 'Performance comercial', icon: Activity },
      { id: 'contracts', label: 'Contratos', icon: ClipboardCheck },
      { id: 'clients', label: 'Clientes', icon: Users },
      { id: 'team', label: 'Equipe Mugô', icon: UserRoundCog, supabaseOnly: true },
      { id: 'services', label: 'Serviços e preços', icon: Library },
      { id: 'finance', label: 'Financeiro', icon: WalletCards },
      { id: 'documents', label: 'Importar documento', icon: Upload },
    ],
  },
  { label: 'Sistema', links: [
    { id: 'organization-settings', label: 'Configurações da empresa', icon: SlidersHorizontal, supabaseOnly: true },
    { id: 'commercial-trash', label: 'Lixeira comercial', icon: Trash2, supabaseOnly: true },
    { id: 'commercial-integrity', label: 'Integridade Comercial', icon: ShieldCheck, adminOnly: true, supabaseOnly: true },
    { id: 'diagnostic', label: 'Diagnóstico Supabase', icon: Activity, adminOnly: true },
    { id: 'settings', label: 'Configurações', icon: Settings, disabled: true },
  ] },
]

export function Sidebar({ activePage, onNavigate, open, collapsed, onClose, onToggleCollapse }) {
  const { isLegacy, signOut, profile } = useAuth()
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
        <MugoBrand variant={collapsed ? 'symbol' : 'full'} theme="dark" />
        <button type="button" className="sidebar-close" onClick={onClose} aria-label="Fechar menu">
          <X size={20} />
        </button>
      </div>
      <nav className="sidebar-nav">
        {groups.map((group) => (
          <div className="nav-group" key={group.label}>
            <p className="nav-group-label">{group.label}</p>
            {group.links.filter((link)=>!link.supabaseOnly||!isLegacy).filter((link)=>!link.adminOnly||profile?.role==='admin').map((link) => {
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
                  <span>{NAVIGATION_LABELS[link.id] || link.label}</span>
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
