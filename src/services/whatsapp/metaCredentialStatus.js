const DAY_MS = 86_400_000

export function getMetaCredentialStatus(value = import.meta.env.VITE_META_TOKEN_EXPIRES_AT, now = new Date()) {
  if (!value) return { state: 'unknown', expiresAt: null, daysRemaining: null, message: 'Validade da credencial Meta não informada.' }
  const expiresAt = new Date(value)
  if (Number.isNaN(expiresAt.getTime())) return { state: 'unknown', expiresAt: null, daysRemaining: null, message: 'Validade da credencial Meta não informada.' }
  const daysRemaining = Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS)
  if (daysRemaining <= 0) return { state: 'expired', expiresAt, daysRemaining, message: 'A credencial Meta expirou. Atualize a configuração da integração.' }
  if (daysRemaining <= 30) return { state: 'warning', expiresAt, daysRemaining, message: `A credencial Meta expira em ${daysRemaining} ${daysRemaining === 1 ? 'dia' : 'dias'}.` }
  const formatted = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }).format(expiresAt)
  return { state: 'valid', expiresAt, daysRemaining, message: `Credencial Meta válida até ${formatted}` }
}
