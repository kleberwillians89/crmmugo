const clean = (value) => String(value ?? '').trim()

export const isoDateInZone = (zone = 'America/Sao_Paulo', date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)

export const isBusinessDay = (zone = 'America/Sao_Paulo', date = new Date()) => {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short' }).format(date)
  return !['Sat', 'Sun'].includes(weekday)
}

// Fonte de tarefas (crm_tasks) para Meu Dia, LIST_MINE e digests — não inclui atividades concluídas
// (operational_events); LIST_MINE/DAY_SUMMARY consultam operational_events à parte para isso. O
// backlog sem data não entra no resumo diário; tarefas concluídas/canceladas nunca reaparecem como pendência.
export async function getMemberTaskReadModel(admin, organizationId, teamMemberId, day, options = {}) {
  const limit = Number(options.limit || 100)
  const result = await admin.from('crm_tasks')
    .select('id,title,status,priority,due_date,planned_hours,assigned_to')
    .eq('organization_id', organizationId)
    .eq('assigned_to', teamMemberId)
    .not('status', 'in', '(completed,cancelled)')
    .not('due_date', 'is', null)
    .lte('due_date', day)
    .order('due_date', { ascending: true })
    .order('priority', { ascending: false })
    .limit(limit)
  if (result.error) throw result.error
  const tasks = result.data || []
  const today = tasks.filter((item) => item.due_date === day)
  const overdue = tasks.filter((item) => item.due_date < day)
  const candidateItems = tasks.map((item, index) => ({
    index: index + 1,
    type: 'task',
    task_id: item.id,
    label: clean(item.title),
    due_date: item.due_date,
    priority: item.priority,
  }))
  return {
    day,
    tasks,
    today,
    overdue,
    candidateItems,
    plannedHours: today.reduce((sum, item) => sum + Number(item.planned_hours || 0), 0),
  }
}
