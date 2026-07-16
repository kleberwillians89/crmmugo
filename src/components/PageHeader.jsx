import { MugoSymbol } from './brand/MugoSymbol'

export function PageHeader({ eyebrow, title, titleAccessory, description, actions }) {
  return (
    <header className="page-header">
      <div className="page-header-copy">
        <div className="page-header-brand"><MugoSymbol size={22} /><p className="eyebrow">{eyebrow}</p></div>
        <div className="page-header-title-row"><h1>{title}</h1>{titleAccessory}</div>
        {description && <p className="page-description">{description}</p>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  )
}
