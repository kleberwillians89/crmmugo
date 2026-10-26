// Regras da tela Hoje (lista estilo Notion): grupos, rótulos de prazo e o diário da Secretária.
import { addIsoDays } from './operationalCalendar.js'

const OPEN = (task) => !task.archived_at && !['completed', 'cancelled'].includes(task.status)
const WEEKDAY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

export function greeting(hour) {
  if (hour < 5) return 'Boa noite'
  if (hour < 12) return 'Bom dia'
  if (hour < 18) return 'Boa tarde'
  return 'Boa noite'
}

export function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || ''
}

/** Membro da equipe ligado ao login (auth_profile_id); cai para o nome se não houver vínculo. */
export function memberForProfile(teamMembers = [], profile = null) {
  if (!profile) return null
  return teamMembers.find((member) => member.auth_profile_id && member.auth_profile_id === profile.id)
    || teamMembers.find((member) => member.id === profile.id)
    || teamMembers.find((member) => firstName(member.name).toLowerCase() === firstName(profile.name).toLowerCase())
    || null
}

/** Atrasadas / Hoje / Próximos 7 dias, só tarefas abertas. scope 'mine' filtra pelo responsável. */
export function buildTodayGroups(tasks = [], { today, memberId = null, scope = 'mine', days = 7 } = {}) {
  const limit = addIsoDays(today, days)
  const visible = tasks.filter(OPEN).filter((task) => scope !== 'mine' || !memberId || task.assigned_to === memberId)
  const byTime = (a, b) => String(a.due_date || '').localeCompare(String(b.due_date || '')) || String(a.due_time || '99').localeCompare(String(b.due_time || '99')) || String(a.title).localeCompare(String(b.title))
  return {
    overdue: visible.filter((task) => task.due_date && task.due_date < today).sort(byTime),
    today: visible.filter((task) => task.due_date === today).sort(byTime),
    upcoming: visible.filter((task) => task.due_date && task.due_date > today && task.due_date <= limit).sort(byTime),
    undated: visible.filter((task) => !task.due_date).length,
  }
}

/** "ontem", "há 3 dias", "14:00", "até 17:00", "amanhã", "qua, 28/10". */
export function dueLabel(task, today) {
  if (!task?.due_date) return ''
  const time = task.due_time ? String(task.due_time).slice(0, 5) : ''
  if (task.due_date === today) return time ? (task.ends_at || task.fixed ? time : `até ${time}`) : 'hoje'
  if (task.due_date < today) {
    const days = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${task.due_date}T12:00:00Z`)) / 86_400_000)
    return days === 1 ? 'ontem' : `há ${days} dias`
  }
  if (task.due_date === addIsoDays(today, 1)) return time ? `amanhã ${time}` : 'amanhã'
  const date = new Date(`${task.due_date}T12:00:00Z`)
  return `${WEEKDAY[date.getUTCDay()]}, ${task.due_date.slice(8, 10)}/${task.due_date.slice(5, 7)}`
}

export function relatedLabel(task) {
  return task?.clients?.company_name || task?.commercial_opportunities?.name || task?.proposals?.title || ''
}

/** Texto de cada linha do diário da Secretária (vem da função secretary_feed do banco). */
export function describeFeedItem(item = {}) {
  const who = firstName(item.member_name) || 'alguém do time'
  const title = String(item.title || '').trim()
  if (item.source === 'command') {
    const reply = String(item.detail || '')
    if (/^(Prontinho|Tarefa criada|Pronto)/i.test(reply)) return { who, text: `criou tarefa pelo WhatsApp: “${title}”` }
    if (/conclu/i.test(reply)) return { who, text: /^(feito|pronto|ok|concluído|concluida|concluída|feito \d+|\d+ feito)$/i.test(title) ? 'marcou uma tarefa como feita pelo WhatsApp' : `marcou como feito pelo WhatsApp: “${title}”` }
    return { who, text: `falou com a Secretária: “${title}”` }
  }
  switch (item.kind) {
    case 'morning_digest': return { who, text: 'recebeu o resumo do dia' }
    case 'midday_digest': return { who, text: 'recebeu o resumo do meio-dia' }
    case 'end_of_day_digest': return { who, text: 'recebeu o fechamento do dia' }
    case 'task_assigned': return { who, text: `foi avisado(a) da tarefa “${title}”` }
    case 'overdue_tasks': return { who, text: 'foi lembrado(a) das tarefas atrasadas' }
    case 'human_mode_message':
    case 'handoff_reminder':
    case 'handoff_escalation':
    case 'handoff_critical': return { who, text: `foi avisado(a): ${title || 'lead'} esperando atendimento` }
    case 'task_reminder': return { who, text: `foi lembrado(a) de “${title}”` }
    default: return { who, text: 'recebeu um aviso no WhatsApp' }
  }
}

/** Minutos/horas desde a última mensagem do contato: "12 min", "3 h", "2 d". */
export function waitingFor(iso, now) {
  const ms = now - Date.parse(iso || '')
  if (!Number.isFinite(ms) || ms < 0) return ''
  const min = Math.floor(ms / 60_000)
  if (min < 60) return `${Math.max(min, 1)} min`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours} h`
  return `${Math.floor(hours / 24)} d`
}
