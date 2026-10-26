// Quadro da prospecção (estilo Trello): em que coluna cada prospect está e o que muda ao arrastar.

export const PROSPECT_COLUMNS = [
  { id: 'ready', label: 'Pronto para abordar', hint: 'Pesquisado, convite ainda não enviado' },
  { id: 'invited', label: 'Convite enviado', hint: 'Esperando aceitar' },
  { id: 'connected', label: 'Aceitou', hint: 'Mandar a mensagem' },
  { id: 'messaged', label: 'Mensagem enviada', hint: 'Esperando resposta' },
  { id: 'replied', label: 'Respondeu', hint: 'Já está no funil Comercial' },
  { id: 'out', label: 'Descartado', hint: 'Pulado ou sem perfil' },
]

export function columnFor(prospect = {}) {
  if (['replied', 'meeting', 'converted'].includes(prospect.status)) return 'replied'
  if (['disqualified', 'do_not_contact'].includes(prospect.status) || prospect.linkedin_state === 'skipped') return 'out'
  if (prospect.linkedin_state === 'messaged') return 'messaged'
  if (prospect.linkedin_state === 'connected') return 'connected'
  if (prospect.linkedin_state === 'connection_sent') return 'invited'
  if (prospect.research_status === 'done') return 'ready'
  return null // ainda sem pesquisa: fica fora do quadro
}

/** Patch no prospect ao mover de coluna. 'replied' não é patch: vira oportunidade no funil (convert). */
export function patchForColumn(column, prospect = {}, now = new Date().toISOString()) {
  const touched = { last_contact_at: now, ...(['new', 'ready'].includes(prospect.status) ? { status: 'contacted' } : {}) }
  switch (column) {
    case 'ready': return { linkedin_state: 'pending', status: 'ready' }
    case 'invited': return { linkedin_state: 'connection_sent', ...touched }
    case 'connected': return { linkedin_state: 'connected', ...touched }
    case 'messaged': return { linkedin_state: 'messaged', ...touched }
    case 'out': return { linkedin_state: 'skipped', ...(prospect.status === 'ready' || prospect.status === 'new' ? { status: 'disqualified' } : {}) }
    default: return null
  }
}

export function daysSince(iso, now = Date.now()) {
  const ms = now - Date.parse(iso || '')
  if (!Number.isFinite(ms) || ms < 0) return null
  return Math.floor(ms / 86_400_000)
}
