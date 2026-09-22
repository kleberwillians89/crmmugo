const clean = (value: unknown) => String(value ?? '').trim()
const request = async (path: string, method: string, body?: unknown) => {
  const token = Deno.env.get('NOTION_TOKEN') || ''
  if (!token) throw Object.assign(new Error('Credencial Notion não configurada.'), { code: 'NOTION_NOT_CONFIGURED' })
  const response = await fetch(`https://api.notion.com/v1${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Notion-Version': Deno.env.get('NOTION_API_VERSION') || '2022-06-28' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(clean(payload?.message) || `Notion respondeu ${response.status}.`), { code: response.status === 429 || response.status >= 500 ? 'NOTION_TEMPORARY_ERROR' : 'NOTION_REQUEST_FAILED', retryable: response.status === 429 || response.status >= 500 })
  return payload
}
const rich = (value: unknown) => ({ rich_text: clean(value) ? [{ type: 'text', text: { content: clean(value).slice(0, 2000) } }] : [] })
const title = (value: unknown) => ({ title: [{ type: 'text', text: { content: clean(value).slice(0, 2000) } }] })

export async function upsertNotionTask(task: any, config: any, link: any) {
  const databaseId = config?.database_id || config?.data_source_id
  if (!databaseId) throw Object.assign(new Error('Base operacional do Notion não configurada.'), { code: 'NOTION_MAPPING_MISSING' })
  const names = { title: 'Tarefa', status: 'Status', priority: 'Prioridade', due: 'Prazo', assignee: 'Responsável', client: 'Cliente', crm: 'CRM Task ID', source: 'Origem', ...(config.properties || {}) }
  const properties: any = {
    [names.title]: title(task.title),
    [names.status]: { select: { name: task.status } },
    [names.priority]: { select: { name: task.priority } },
    [names.due]: { date: task.due_date ? { start: `${task.due_date}${task.due_time ? `T${task.due_time}-03:00` : ''}` } : null },
    [names.assignee]: rich(task.team_members?.name), [names.client]: rich(task.clients?.company_name),
    [names.crm]: rich(task.id), [names.source]: { select: { name: task.source || 'crm' } },
  }
  const page = link?.external_id
    ? await request(`/pages/${encodeURIComponent(link.external_id)}`, 'PATCH', { properties })
    : await request('/pages', 'POST', { parent: { database_id: databaseId }, properties })
  return { external_id: page.id, external_url: page.url, external_parent_id: databaseId, external_status: task.status }
}

export async function getNotionPage(pageId: string) { return request(`/pages/${encodeURIComponent(pageId)}`, 'GET') }

export async function createNotionCommercialBriefing(opportunity: any, config: any) {
  const databaseId=config?.briefing_database_id||config?.database_id||config?.data_source_id
  if(!databaseId)throw Object.assign(new Error('Base de briefings do Notion não configurada.'),{code:'NOTION_BRIEFING_MAPPING_MISSING'})
  const client=opportunity.clients||{},qualification=opportunity.commercial_qualifications?.[0]||opportunity.commercial_qualifications||{}
  const properties:any={
    [config?.briefing_properties?.title||'Briefing']:title(`${client.company_name||opportunity.name} — ${(opportunity.service_interests||[]).join(' + ')||'Oportunidade'}`),
    [config?.briefing_properties?.company||'Empresa']:rich(client.company_name||opportunity.name),
    [config?.briefing_properties?.contact||'Contato']:rich(client.contact_name),
    [config?.briefing_properties?.status||'Status']:{select:{name:opportunity.stage}},
    [config?.briefing_properties?.crm||'CRM Opportunity ID']:rich(opportunity.id),
  }
  const sections=[['Problema',qualification.main_problem||opportunity.main_problem],['Objetivo',qualification.objective],['Serviços',(opportunity.service_interests||[]).join(' + ')],['Resumo da conversa',opportunity.conversation_summary],['Prazo',qualification.timeline||opportunity.timeline],['Orçamento',qualification.budget||opportunity.budget],['Observações',opportunity.internal_notes],['Próximos passos',opportunity.next_action]].filter(([,value])=>value!==null&&value!==undefined&&value!=='')
  const children=sections.map(([heading,value])=>({object:'block',type:'paragraph',paragraph:{rich_text:[{type:'text',text:{content:`${heading}: ${clean(value).slice(0,1800)}`}}]}}))
  const page=await request('/pages','POST',{parent:{database_id:databaseId},properties,children})
  return{external_id:page.id,external_url:page.url}
}
