import { AlertCircle, CheckCircle2 } from 'lucide-react'

export function FeedbackMessage({ type = 'success', children }) {
  const Icon = type === 'error' ? AlertCircle : CheckCircle2

  return (
    <div className={`feedback-message ${type}`} role={type === 'error' ? 'alert' : 'status'}>
      <Icon size={18} aria-hidden="true" />
      <span>{children}</span>
    </div>
  )
}
