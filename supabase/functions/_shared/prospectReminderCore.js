// Lembretes de prospecção no WhatsApp: a Secretária manda, em horários fixos, o próximo convite (ou a
// mensagem pós-aceite) pronto para quem prospecta copiar e colar no LinkedIn. O envio é sempre manual.
// Puro (sem rede) para testar com node --test.

export const DEFAULT_REMINDER_TIMES = ['09:00', '10:30', '14:00', '15:30', '17:00']
export const MIN_FIT = 50
const SLOT_WINDOW_MIN = 60

const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max)
const toMinutes = (time) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(time || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null }

export function saoPauloParts(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(date).map((p) => [p.type, p.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute), weekend: ['Sat', 'Sun'].includes(parts.weekday) }
}

export function normalizeTimes(times) {
  const list = (Array.isArray(times) ? times : String(times || '').split(/[,;\s]+/)).map((t) => clean(t, 5)).filter((t) => toMinutes(t) != null && toMinutes(t) >= 7 * 60 && toMinutes(t) <= 20 * 60)
  const unique = [...new Set(list.map((t) => { const m = toMinutes(t); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` }))].sort()
  return unique.length ? unique.slice(0, 10) : DEFAULT_REMINDER_TIMES
}

/** Horários que já chegaram e ainda estão dentro de 1h (slot perdido há mais tempo não é recuperado). Só dias úteis. */
export function dueSlots(times, now = saoPauloParts()) {
  if (now.weekend) return []
  return normalizeTimes(times).filter((t) => { const m = toMinutes(t); return m <= now.minutes && now.minutes - m < SLOT_WINDOW_MIN })
}

/** Próximo da fila: primeiro quem aceitou e espera a mensagem; depois convites com nota pronta, melhor nota primeiro. */
export function pickNextProspect(rows = [], { nowIso = new Date().toISOString() } = {}) {
  const recent = (row) => row.linkedin_reminded_at && Date.parse(nowIso) - Date.parse(row.linkedin_reminded_at) < 20 * 3600_000
  const usable = rows.filter((row) => !recent(row) && !['disqualified', 'do_not_contact', 'converted', 'replied'].includes(row.status))
  const message = usable.filter((row) => row.linkedin_state === 'connected' && clean(row.linkedin_message))
  if (message.length) return { prospect: message[0], stage: 'message' }
  const invites = usable
    .filter((row) => row.linkedin_state === 'pending' && row.research_status === 'done' && clean(row.linkedin_note) && Number(row.fit_score || 0) >= MIN_FIT)
    .sort((a, b) => Number(b.fit_score || 0) - Number(a.fit_score || 0))
  return invites.length ? { prospect: invites[0], stage: 'invite' } : null
}

/** Quantos pesquisar hoje para a fila não secar: o dobro dos horários, descontando os que já estão prontos. */
export function researchToQueue(readyCount, slotsPerDay = DEFAULT_REMINDER_TIMES.length) {
  return Math.max(0, Math.min(10, slotsPerDay * 2 - Number(readyCount || 0)))
}

export const linkedinSearchUrl = (prospect = {}) => `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent([prospect.contact_name, prospect.company_name].filter(Boolean).join(' '))}`

export function reminderPayload({ prospect, stage, position = null, total = null }) {
  return {
    kind: 'prospect_invite',
    stage,
    prospect_id: prospect.id,
    name: clean(prospect.contact_name, 120) || 'Decisor',
    role: clean(prospect.contact_role, 120),
    company: clean(prospect.company_name, 160),
    profile_url: clean(prospect.contact_linkedin_url, 300) || linkedinSearchUrl(prospect),
    profile_is_search: !prospect.contact_linkedin_url,
    text: clean(stage === 'message' ? prospect.linkedin_message : prospect.linkedin_note, 1200),
    position, total,
    candidate_items: [{ index: 1, type: 'prospect', prospect_id: prospect.id, stage, label: clean(prospect.contact_name || prospect.company_name, 120) }],
  }
}

export function reminderMessage(p = {}) {
  const head = p.stage === 'message' ? `${p.name} aceitou o convite 🎉 Hora da mensagem:` : `Próximo convite do LinkedIn${p.position && p.total ? ` (${p.position} de ${p.total} hoje)` : ''}:`
  const who = `*${p.name}*${p.role ? ` — ${p.role}` : ''}${p.company ? ` · ${p.company}` : ''}`
  if (p.stage === 'message') return [head, '', who, p.profile_url, '', 'Abra a conversa com a pessoa no LinkedIn e cole:', '', p.text, '', 'Depois me responde *feito* (ou *pular*).'].join('\n')
  const open = p.profile_is_search ? 'Ache o perfil na busca e clique em *Conectar → Enviar sem nota*.' : 'Abra o perfil e clique em *Conectar → Enviar sem nota*.'
  return [head, '', who, p.profile_url, '', open, 'A abordagem vai na mensagem, quando a pessoa aceitar.', '', p.text ? `(Se ainda tiver nota disponível no mês, pode usar esta: ${p.text})` : '', '', 'Depois me responde *feito* (ou *pular*).'].filter((line, i, all) => line !== '' || all[i - 1] !== '').join('\n')
}

const DONE = /^(feito|fiz|enviei|enviado|mandei|mandado|pronto|ok|ok feito|convite enviado|foi|conectei)[.!]*$/
const SKIP = /^(pula|pular|pulei|pulou|depois|nao|não|agora nao|agora não|pula esse|proximo|próximo)[.!]*$/
/** Resposta a um lembrete de prospecção: done | skip | null. Recebe o texto já normalizado (minúsculo, sem acento no "nao"). */
export function prospectReplyAction(folded) {
  const text = String(folded || '').trim()
  if (DONE.test(text)) return 'done'
  if (SKIP.test(text)) return 'skip'
  return null
}
