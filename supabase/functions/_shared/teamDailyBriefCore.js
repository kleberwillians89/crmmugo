const clean = (value) => String(value ?? '').trim()
const SP_TZ = 'America/Sao_Paulo'

export const todayInSaoPaulo = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: SP_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)

const weekdayInSaoPaulo = (now = new Date()) =>
  new Intl.DateTimeFormat('en-US', { timeZone: SP_TZ, weekday: 'short' }).format(now)

// hourCycle:'h23' evita o caso conhecido do Intl onde meia-noite vira "24" em vez de "0".
export const hourInSaoPaulo = (now = new Date()) =>
  Number(new Intl.DateTimeFormat('en-GB', { timeZone: SP_TZ, hour: '2-digit', hourCycle: 'h23' }).format(now))

export const isBusinessDayInSaoPaulo = (now = new Date()) => !['Sat', 'Sun'].includes(weekdayInSaoPaulo(now))

// A decisão de "pode rodar agora" nunca depende do horário UTC do servidor — só do relógio de
// America/Sao_Paulo. TEAM_DAILY_BRIEF_HOUR só define a partir de que hora local o worker passa a
// enviar; a idempotência diária (por membro+data) impede reenvio caso o cron rode várias vezes.
export const shouldRunDailyBrief = (now = new Date(), configuredHour = 8) =>
  isBusinessDayInSaoPaulo(now) && hourInSaoPaulo(now) >= Number(configuredHour)

// Só hoje e atrasadas (nunca tarefa futura, nunca tarefa sem due_date/backlog). O filtro
// status NOT IN ('completed','cancelled') já vem da query do worker — esta função só separa por data.
export function selectDailyBriefTasks(rows, today) {
  const open = (Array.isArray(rows) ? rows : []).filter((row) => row.due_date && row.due_date <= today)
  return {
    todayTasks: open.filter((row) => row.due_date === today),
    overdueTasks: open.filter((row) => row.due_date < today),
  }
}

const clientName = (row) => row.clients?.trade_name || row.clients?.company_name || null
const HIGH_PRIORITY = new Set(['high', 'critical'])
const taskLabel = (row) => {
  const client = clientName(row)
  return `${HIGH_PRIORITY.has(row.priority) ? '🔴 ' : ''}${clean(row.title)}${client ? ` (${client})` : ''}${row.due_time ? ` — ${String(row.due_time).slice(0, 5)}` : ''}`
}

// Parâmetro {{2}} do template Meta: a API rejeita quebra de linha em parâmetro de template, então isto
// é sempre uma única linha, itens separados por "; ". Nunca contém dado de outro membro — só recebe as
// linhas já filtradas por assigned_to no worker.
export function buildDailyBriefSummary({ todayTasks = [], overdueTasks = [] } = {}) {
  const todayPart = todayTasks.length
    ? `Hoje: ${todayTasks.map((row) => taskLabel(row)).join('; ')}.`
    : 'Hoje: nenhuma demanda com prazo.'
  const overduePart = overdueTasks.length
    ? ` Atrasadas (${overdueTasks.length}): ${overdueTasks.map((row) => taskLabel(row)).join('; ')}.`
    : ''
  return clean(`${todayPart}${overduePart}`)
}

// Texto multilinha legível só para o histórico do CRM (whatsapp_messages.text_content) — não é o que é
// enviado como parâmetro de template para a Meta (ver buildDailyBriefSummary).
export function buildDailyBriefDisplayText({ firstName, todayTasks = [], overdueTasks = [] }) {
  const lines = [`Bom dia, ${clean(firstName)}.`, '']
  if (todayTasks.length) {
    lines.push(`Hoje você tem ${todayTasks.length} demanda${todayTasks.length === 1 ? '' : 's'}:`, '')
    todayTasks.forEach((row, index) => lines.push(`${index + 1}. ${taskLabel(row)}`))
  } else {
    lines.push('Hoje você não tem demandas com prazo.')
  }
  if (overdueTasks.length) {
    lines.push('', `Atrasadas: ${overdueTasks.length}`)
    overdueTasks.forEach((row) => lines.push(`• ${taskLabel(row)}`))
  }
  lines.push('', 'Acesse o CRM Mugô para atualizar o andamento.')
  return lines.join('\n')
}
