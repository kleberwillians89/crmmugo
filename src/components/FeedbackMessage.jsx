import { AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react'

export function FeedbackMessage({ type = 'success', children, details }) {
  const Icon = type === 'error' ? AlertCircle : type === 'warning' ? AlertTriangle : CheckCircle2

  return (
    <div className={`feedback-message ${type}`} role={type === 'error' ? 'alert' : 'status'}>
      <Icon size={18} aria-hidden="true" />
      <span>{children}{details&&Object.values(details).some(Boolean)&&<details className="technical-error"><summary>Detalhes técnicos</summary><dl>{Object.entries(details).filter(([,value])=>value!=null&&value!=='').map(([key,value])=><div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl></details>}</span>
    </div>
  )
}
