const clean = (value: unknown) => String(value ?? '').trim()
const request = async (path: string, method: string, body: Record<string, unknown> = {}) => {
  const key = Deno.env.get('TRELLO_API_KEY') || ''; const token = Deno.env.get('TRELLO_TOKEN') || ''
  if (!key || !token) throw Object.assign(new Error('Credenciais Trello não configuradas.'), { code: 'TRELLO_NOT_CONFIGURED' })
  const params = new URLSearchParams({ key, token }); const clientIdentifier = clean(body._clientIdentifier)
  for (const [name, value] of Object.entries(body)) if (name !== '_clientIdentifier' && value !== null && value !== undefined && value !== '') params.set(name, String(value))
  const response = await fetch(`https://api.trello.com/1${path}?${params}`, { method, headers: clientIdentifier ? { 'X-Trello-Client-Identifier': clientIdentifier } : {}, signal: AbortSignal.timeout(20_000) })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(clean(payload?.message) || `Trello respondeu ${response.status}.`), { code: response.status === 429 || response.status >= 500 ? 'TRELLO_TEMPORARY_ERROR' : 'TRELLO_REQUEST_FAILED', retryable: response.status === 429 || response.status >= 500 })
  return payload
}

const listForStatus = (status: string, config: any) => status === 'completed' ? config.completed_list_id : status === 'in_progress' ? config.in_progress_list_id : config.todo_list_id
export async function upsertTrelloTask(task: any, config: any, link: any) {
  const idList = listForStatus(task.status, config)
  if (!config?.board_id || !idList) throw Object.assign(new Error('Board e listas do Trello não configurados.'), { code: 'TRELLO_MAPPING_MISSING' })
  const due = task.due_date ? `${task.due_date}T${task.due_time || '18:00:00'}-03:00` : ''
  const desc = [task.notes, task.clients?.company_name && `Cliente: ${task.clients.company_name}`, task.team_members?.name && `Responsável: ${task.team_members.name}`, `CRM Task ID: ${task.id}`, `Origem: ${task.source || 'crm'}`].filter(Boolean).join('\n\n')
  const values = { name: task.title, desc, idList, due, dueComplete: task.status === 'completed', _clientIdentifier: `mugo-crm:${task.id}` }
  const card = link?.external_id ? await request(`/cards/${encodeURIComponent(link.external_id)}`, 'PUT', values) : await request('/cards', 'POST', values)
  return { external_id: card.id, external_url: card.url, external_parent_id: idList, external_status: task.status }
}

export async function getTrelloCard(cardId: string) {
  return request(`/cards/${encodeURIComponent(cardId)}`, 'GET', { fields: 'id,name,desc,due,dueComplete,idList,dateLastActivity,url' })
}
