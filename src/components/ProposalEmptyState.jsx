import { FileSearch, Plus } from 'lucide-react'

export function ProposalEmptyState({ title, description, actionLabel, onAction, compact = false }) {
  return <div className={`proposal-empty${compact ? ' compact' : ''}`}>
    <div><FileSearch size={20} /></div><strong>{title}</strong><p>{description}</p>
    {onAction && <button type="button" className="button small" onClick={onAction}><Plus size={14} />{actionLabel}</button>}
  </div>
}
