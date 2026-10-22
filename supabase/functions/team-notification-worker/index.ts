// Alertas proativos para o time interno da Mugô (resumo da manhã, alerta operacional, fechamento
// do dia). SOMENTE números internos autorizados (team_members ativos com telefone). Nunca envia
// para clientes somente o aviso transacional único do SLA de handoff; nunca expõe
// household/private/reservas/distribuição de sócios.
// Deploy e scheduler são manuais (mesmo modelo de task-command-worker/commercial-notification-worker).
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TEAM_NOTIFICATION_WORKER_KEY, META_ACCESS_TOKEN.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { normalizeBrazilianPhone } from '../_shared/internalCommandCore.js'
import { getMemberTaskReadModel } from '../_shared/internalAssistantReadModel.js'
import { getOperationalWindow } from '../_shared/operationalCalendar.js'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const clean = (value: unknown, max = 1000) => String(value ?? '').trim().slice(0, max)
const isoDateInZone = (zone: string, date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
const hhmmInZone = (zone: string, date = new Date()) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
const minutesOf = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
// Tolerância para o intervalo do agendador externo (pg_cron/cron externo) que invoca este worker.
const WINDOW_MINUTES = 7

async function isAdminMember(admin: any, orgId: string, teamMember: any) {
  if (!teamMember?.auth_profile_id) return false
  const profile = await admin.from('profiles').select('role').eq('id', teamMember.auth_profile_id).eq('organization_id', orgId).eq('active', true).maybeSingle()
  if (profile.error) throw profile.error
  return ['admin', 'manager'].includes(profile.data?.role)
}

async function enqueue(admin: any, organizationId: string, teamMemberId: string, type: string, idempotencyKey: string, payload: any) {
  const result = await admin.from('team_notification_outbox').insert({ organization_id: organizationId, team_member_id: teamMemberId, notification_type: type, payload, idempotency_key: idempotencyKey }).select('id')
  if (result.error && result.error.code !== '23505') throw result.error
}

async function enqueueDigests(admin: any) {
  const settings = await admin.from('organization_settings').select('organization_id,timezone,morning_digest_enabled,morning_digest_time,midday_digest_enabled,midday_digest_time,end_of_day_digest_enabled,end_of_day_digest_time,last_digest_enabled,last_digest_time')
  if (settings.error) throw settings.error
  for (const org of settings.data || []) {
    const zone = org.timezone || 'America/Sao_Paulo'
    const nowMinutes = minutesOf(hhmmInZone(zone))
    const today = isoDateInZone(zone)
    const operationalWindow=await getOperationalWindow(admin,org.organization_id)
    if (!operationalWindow.businessDay) continue
    const due = (enabled: boolean, time: string) => enabled && Math.abs(nowMinutes - minutesOf(String(time).slice(0, 5))) <= WINDOW_MINUTES
    const morningDue=due(org.morning_digest_enabled,org.morning_digest_time)
    const middayDue=due(org.midday_digest_enabled,org.midday_digest_time)
    const endDue=due(org.end_of_day_digest_enabled,org.end_of_day_digest_time)
    const lastDue=due(org.last_digest_enabled,org.last_digest_time)
    if (!morningDue&&!middayDue&&!endDue&&!lastDue) continue
    const members = await admin.from('team_members').select('id').eq('organization_id', org.organization_id).eq('active', true).not('phone', 'is', null)
    if (members.error) throw members.error
    if (morningDue) {
      for (const member of members.data || []) {
        const payload = await buildMorningDigest(admin, org.organization_id, member.id, today)
        await enqueue(admin, org.organization_id, member.id, 'morning_digest', `morning:${member.id}:${today}`, payload)
      }
    }
    if(middayDue){
      for(const member of members.data||[]){
        const payload=await buildMorningDigest(admin,org.organization_id,member.id,today)
        const relevant=payload.overdue.length||payload.today.some((task:any)=>['high','critical'].includes(task.priority))
        if(relevant)await enqueue(admin,org.organization_id,member.id,'midday_digest',`midday:${member.id}:${today}`,{...payload,kind:'midday_priorities'})
      }
    }
    if (endDue) {
      for (const member of members.data || []) {
        const payload = await buildEndOfDayDigest(admin, org.organization_id, member.id, today, zone)
        await enqueue(admin, org.organization_id, member.id, 'end_of_day_digest', `eod:${member.id}:${today}`, payload)
      }
    }
    if(lastDue){
      for(const member of members.data||[]){
        const payload=await buildMorningDigest(admin,org.organization_id,member.id,today)
        if(payload.overdue.length||payload.today.length)await enqueue(admin,org.organization_id,member.id,'last_digest',`last:${member.id}:${today}`,{...payload,kind:'last_daily_summary'})
      }
    }
  }
}

async function buildMorningDigest(admin: any, organizationId: string, teamMemberId: string, today: string) {
  const model = await getMemberTaskReadModel(admin, organizationId, teamMemberId, today)
  return { today: model.today, overdue: model.overdue, plannedHours: model.plannedHours, candidate_items: model.candidateItems }
}

async function buildEndOfDayDigest(admin: any, organizationId: string, teamMemberId: string, today: string, zone: string) {
  const start = `${today}T00:00:00-03:00`, end = `${today}T23:59:59.999-03:00`
  const [events, tasksCompleted, tasksOpen, pendingFinancial] = await Promise.all([
    admin.from('operational_events').select('event_type,metadata').eq('organization_id', organizationId).eq('team_member_id', teamMemberId).gte('created_at', start).lte('created_at', end),
    admin.from('crm_tasks').select('id').eq('organization_id', organizationId).eq('assigned_to', teamMemberId).eq('status', 'completed').gte('completed_at', start).lte('completed_at', end),
    admin.from('crm_tasks').select('id').eq('organization_id', organizationId).eq('assigned_to', teamMemberId).not('status', 'in', '(completed,cancelled)'),
    admin.from('financial_command_confirmations').select('id').eq('organization_id', organizationId).eq('team_member_id', teamMemberId).eq('status', 'pending').gt('expires_at', new Date().toISOString()),
  ])
  if (events.error) throw events.error
  if (tasksCompleted.error) throw tasksCompleted.error
  if (tasksOpen.error) throw tasksOpen.error
  if (pendingFinancial.error) throw pendingFinancial.error
  const rows = events.data || []
  const hours = rows.filter((row: any) => row.event_type === 'time_recorded').reduce((sum: number, row: any) => sum + Number(row.metadata?.hours || 0), 0)
  const decisions = rows.filter((row: any) => row.event_type === 'client_decision').length
  return { hours, tasksCompleted: tasksCompleted.data?.length || 0, tasksOpen: tasksOpen.data?.length || 0, decisions, pendingFinancial: pendingFinancial.data?.length || 0 }
}

async function enqueueOperationalAlerts(admin: any) {
  const members = await admin.from('team_members').select('id,organization_id,auth_profile_id').eq('active', true).not('phone', 'is', null)
  if (members.error) throw members.error
  for (const member of members.data || []) {
    const operationalWindow=await getOperationalWindow(admin,member.organization_id),zone=operationalWindow.zone,today=operationalWindow.localDate
    if(!operationalWindow.open)continue
    const model=await getMemberTaskReadModel(admin,member.organization_id,member.id,today)
    if (model.overdue.length) await enqueue(admin, member.organization_id, member.id, 'operational_alert', `alert:overdue-tasks:${member.id}:${today}`, { kind: 'overdue_tasks', count: model.overdue.length, candidate_items: model.overdue.map((task:any,index:number)=>({index:index+1,type:'task',task_id:task.id,label:task.title,due_date:task.due_date,priority:task.priority})) })
    if (!(await isAdminMember(admin, member.organization_id, member))) continue
    const tomorrow = new Date(`${today}T12:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
    const dueTomorrow = await admin.from('invoice_installments').select('id,amount,clients(company_name)').eq('organization_id', member.organization_id).eq('due_date', isoDateInZone(zone, tomorrow)).in('status', ['pending', 'partial'])
    if (dueTomorrow.error) throw dueTomorrow.error
    for (const installment of dueTomorrow.data || []) await enqueue(admin, member.organization_id, member.id, 'operational_alert', `alert:due-tomorrow:${installment.id}`, { kind: 'receivable_due_tomorrow', client: installment.clients?.company_name, amount: installment.amount })
    const pendingConfirmation = await admin.from('financial_command_confirmations').select('id').eq('organization_id', member.organization_id).eq('team_member_id', member.id).eq('status', 'pending').gt('expires_at', new Date().toISOString())
    if (pendingConfirmation.error) throw pendingConfirmation.error
    if (pendingConfirmation.data?.length) await enqueue(admin, member.organization_id, member.id, 'operational_alert', `alert:pending-confirmation:${member.id}:${today}`, { kind: 'pending_confirmation', count: pendingConfirmation.data.length })
  }
}

async function sendClientSlaUpdate(admin:any,conversation:any){
  const idempotencyKey=`handoff-client-sla-15:${conversation.id}:${conversation.handoff_at}`
  const prior=await admin.from('whatsapp_messages').select('id,provider_message_id,status').eq('connection_id',conversation.connection_id).eq('idempotency_key',idempotencyKey).maybeSingle()
  if(prior.error)throw prior.error
  if(prior.data?.provider_message_id||prior.data?.status==='queued')return
  const connection=await admin.from('whatsapp_connections').select('phone_number_id,waba_id').eq('id',conversation.connection_id).eq('organization_id',conversation.organization_id).single()
  if(connection.error)throw connection.error
  const text='Ainda estou acionando nosso time por aqui. Seu atendimento já foi sinalizado como prioridade e alguém continua com você nesta conversa.'
  const withinWindow=Boolean(conversation.service_window_expires_at&&new Date(conversation.service_window_expires_at).getTime()>Date.now())
  let messageType='text',templateName:string|null=null,templateLanguage:string|null=null,templateComponents:any[]=[],metaPayload:any={messaging_product:'whatsapp',recipient_type:'individual',to:conversation.wa_id,type:'text',text:{preview_url:false,body:text}}
  if(!withinWindow){
    templateName=clean(Deno.env.get('MUGO_CLIENT_HANDOFF_SLA_TEMPLATE_NAME'),100);templateLanguage=clean(Deno.env.get('MUGO_CLIENT_TEMPLATE_LANGUAGE')||'pt_BR',20)
    if(!templateName)throw Object.assign(new Error('Configure MUGO_CLIENT_HANDOFF_SLA_TEMPLATE_NAME com um template aprovado.'),{code:'APPROVED_TEMPLATE_REQUIRED'})
    const stored=await admin.from('whatsapp_message_templates').select('status,is_active').eq('organization_id',conversation.organization_id).eq('waba_id',connection.data.waba_id).eq('name',templateName).eq('language',templateLanguage).maybeSingle()
    if(stored.error)throw stored.error
    if(!stored.data||String(stored.data.status).toUpperCase()!=='APPROVED'||stored.data.is_active===false)throw Object.assign(new Error(`O template ${templateName} não está aprovado e ativo.`),{code:'APPROVED_TEMPLATE_REQUIRED'})
    metaPayload={messaging_product:'whatsapp',recipient_type:'individual',to:conversation.wa_id,type:'template',template:{name:templateName,language:{code:templateLanguage}}};messageType='template'
  }
  let reservation=prior.data
  if(!reservation){const reserved=await admin.from('whatsapp_messages').insert({organization_id:conversation.organization_id,connection_id:conversation.connection_id,conversation_id:conversation.id,idempotency_key:idempotencyKey,direction:'out',message_type:messageType,status:'queued',text_content:text,template_name:templateName,template_language:templateLanguage,template_components:templateComponents}).select('id').single();if(reserved.error){if(reserved.error.code==='23505')return;throw reserved.error};reservation=reserved.data}
  else await admin.from('whatsapp_messages').update({status:'queued',error_code:null,error_message:null}).eq('id',reservation.id)
  const token=Deno.env.get('META_ACCESS_TOKEN')||''
  if(!token)throw Object.assign(new Error('Meta não configurada.'),{code:'META_CONFIGURATION_MISSING'})
  const response=await fetch(`https://graph.facebook.com/${Deno.env.get('GRAPH_API_VERSION')||'v23.0'}/${connection.data.phone_number_id}/messages`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(metaPayload),signal:AbortSignal.timeout(20_000)})
  const body=await response.json().catch(()=>({}))
  if(!response.ok||!body?.messages?.[0]?.id){await admin.from('whatsapp_messages').update({status:'failed',failed_at:new Date().toISOString(),error_code:String(response.status),error_message:clean(body?.error?.message,500)}).eq('id',reservation.id);throw Object.assign(new Error(clean(body?.error?.message)||'Falha no aviso transacional do SLA.'),{code:'CLIENT_SLA_SEND_FAILED'})}
  await admin.from('whatsapp_messages').update({provider_message_id:body.messages[0].id,status:'accepted',sent_at:new Date().toISOString()}).eq('id',reservation.id)
}

async function enqueueHandoffSla(admin:any){
  const conversations=await admin.from('whatsapp_conversations').select('id,organization_id,connection_id,wa_id,service_window_expires_at,assigned_team_member_id,opportunity_id,handoff_at,handoff_sla_started_at,whatsapp_contacts(display_name,profile_name)').eq('attendance_mode','human').eq('automation_paused',true).not('handoff_at','is',null).neq('status','closed')
  if(conversations.error)throw conversations.error
  const automatedPrefixes=['commercial-ai:','team-notify:','commercial-notify:','automation:','handoff-client-sla-15:']
  for(const conversation of conversations.data||[]){
    const operationalWindow=await getOperationalWindow(admin,conversation.organization_id)
    if(!operationalWindow.open)continue
    if(!conversation.handoff_sla_started_at){await admin.from('whatsapp_conversations').update({handoff_sla_started_at:new Date().toISOString()}).eq('id',conversation.id).eq('organization_id',conversation.organization_id);continue}
    const settings=await admin.from('commercial_settings').select('commercial_owner_id,handoff_reminder_minutes,handoff_escalation_minutes,handoff_critical_minutes').eq('organization_id',conversation.organization_id).maybeSingle()
    if(settings.error)throw settings.error
    const reminder=Number(settings.data?.handoff_reminder_minutes||5),escalation=Number(settings.data?.handoff_escalation_minutes||15),critical=Number(settings.data?.handoff_critical_minutes||30)
    const elapsed=(Date.now()-new Date(conversation.handoff_sla_started_at).getTime())/60000
    if(elapsed<reminder)continue
    const outbound=await admin.from('whatsapp_messages').select('idempotency_key').eq('organization_id',conversation.organization_id).eq('conversation_id',conversation.id).eq('direction','out').gt('created_at',conversation.handoff_at)
    if(outbound.error)throw outbound.error
    const hasHumanOutbound=(outbound.data||[]).some((message:any)=>!automatedPrefixes.some(prefix=>String(message.idempotency_key||'').startsWith(prefix)))
    if(hasHumanOutbound)continue
    const leadName=conversation.whatsapp_contacts?.display_name||conversation.whatsapp_contacts?.profile_name||`Contato final ${conversation.wa_id.slice(-4)}`
    const candidate_items=[{index:1,type:'conversation',conversation_id:conversation.id,label:leadName}]
    const assigned=conversation.assigned_team_member_id||settings.data?.commercial_owner_id
    if(assigned)await enqueue(admin,conversation.organization_id,assigned,'handoff_reminder',`handoff-reminder:${conversation.id}:${conversation.handoff_at}`,{kind:'handoff_reminder',conversation_id:conversation.id,lead_name:leadName,minutes:reminder,candidate_items})
    if(elapsed<escalation)continue
    let client_notification_error:string|null=null
    try{await sendClientSlaUpdate(admin,conversation)}catch(error:any){client_notification_error=clean(error?.message,500)}
    const profiles=await admin.from('profiles').select('id').eq('organization_id',conversation.organization_id).eq('active',true).in('role',['admin','manager'])
    if(profiles.error)throw profiles.error
    const profileIds=(profiles.data||[]).map((profile:any)=>profile.id)
    if(!profileIds.length)continue
    const admins=await admin.from('team_members').select('id').eq('organization_id',conversation.organization_id).eq('active',true).in('auth_profile_id',profileIds)
    if(admins.error)throw admins.error
    const target=(admins.data||[]).find((member:any)=>member.id!==assigned)||(admins.data||[])[0]
    if(target)await enqueue(admin,conversation.organization_id,target.id,'handoff_escalation',`handoff-escalation:${conversation.id}:${conversation.handoff_at}`,{kind:'handoff_escalation',conversation_id:conversation.id,lead_name:leadName,minutes:escalation,assigned_team_member_id:assigned,client_notification_error,candidate_items})
    if(elapsed>=critical&&target)await enqueue(admin,conversation.organization_id,target.id,'handoff_critical',`handoff-critical:${conversation.id}:${conversation.handoff_at}`,{kind:'handoff_critical',conversation_id:conversation.id,lead_name:leadName,minutes:critical,assigned_team_member_id:assigned,candidate_items})
  }
}

const brl = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0))
function messageFor(item: any, memberName = '') {
  const p = item.payload || {}
  if (item.notification_type === 'morning_digest') {
    const today=p.today||[],overdue=p.overdue||[],firstName=clean(memberName,120).split(' ')[0],lines=[firstName?`Bom dia, ${firstName}.`:'Bom dia.','','Seu dia na Mugô:']
    lines.push('', 'Hoje:')
    if(today.length)for(const task of today)lines.push(`${(p.candidate_items||[]).find((item:any)=>item.task_id===task.id)?.index||'•'}. ${task.title}`)
    else lines.push('Nenhuma tarefa para hoje.')
    lines.push('', 'Atrasadas:')
    if(overdue.length)for(const task of overdue)lines.push(`${(p.candidate_items||[]).find((item:any)=>item.task_id===task.id)?.index||'•'}. ${task.title}`)
    else lines.push('Nenhuma tarefa atrasada.')
    lines.push('', 'Responda com o número ou fale normalmente.', '', '1. Ver todas', '2. Registrar atividade', '3. Criar tarefa', '4. Registrar horas')
    return lines.join('\n')
  }
  if (item.notification_type === 'end_of_day_digest') {
    if (!p.hours) return 'Você ainda não registrou suas horas de hoje.'
    const lines = [`Fechamento Mugô:`, `${p.hours}h registradas`, `${p.tasksCompleted || 0} tarefa${p.tasksCompleted === 1 ? '' : 's'} concluída${p.tasksCompleted === 1 ? '' : 's'}`, `${p.tasksOpen || 0} pendente${p.tasksOpen === 1 ? '' : 's'}`]
    if (p.decisions) lines.push(`${p.decisions} decisão${p.decisions === 1 ? '' : 'ões'} registrada${p.decisions === 1 ? '' : 's'}`)
    lines.push(p.pendingFinancial ? `${p.pendingFinancial} financeiro(s) aguardando confirmação.` : 'Nenhum financeiro aguardando confirmação.')
    return lines.join('\n')
  }
  if (item.notification_type === 'midday_digest') return `Prioridades do meio-dia: ${p.overdue?.length||0} atrasada(s) e ${(p.today||[]).filter((task:any)=>['high','critical'].includes(task.priority)).length} prioridade(s) para hoje.`
  if (item.notification_type === 'last_digest') return `Último resumo do dia: ${p.today?.length||0} tarefa(s) de hoje ainda visíveis e ${p.overdue?.length||0} atrasada(s). Depois das 20h não enviaremos novas rotinas automáticas.`
  if (p.kind === 'overdue_tasks') return `Você tem ${p.count} tarefa${p.count === 1 ? '' : 's'} vencida${p.count === 1 ? '' : 's'}.`
  if (p.kind === 'receivable_due_tomorrow') return `${p.client || 'Cliente'} vence amanhã — ${brl(p.amount)}.`
  if (p.kind === 'pending_confirmation') return `Existe${p.count === 1 ? '' : 'm'} ${p.count} lançamento${p.count === 1 ? '' : 's'} financeiro${p.count === 1 ? '' : 's'} aguardando confirmação.`
  if (p.kind === 'human_mode_message') return `${p.lead_name||'Um contato'} enviou uma nova mensagem durante o atendimento humano:\n“${clean(p.preview,500)}”`
  if (p.kind === 'handoff_reminder') return `Lembrete: ${p.lead_name||'o lead'} aguarda atendimento humano há ${p.minutes} minutos.`
  if (p.kind === 'handoff_escalation') return `Escalonamento: ${p.lead_name||'o lead'} continua sem resposta humana após ${p.minutes} minutos.`
  if (p.kind === 'handoff_critical') return `Alerta crítico: ${p.lead_name||'o lead'} continua sem resposta humana após ${p.minutes} minutos.`
  if (p.kind === 'qualified_lead_handoff') return [`Novo lead aguardando atendimento:`,p.name||p.company||'Lead',p.need?`Demanda: ${p.need}`:null,p.summary?`Contexto: ${p.summary}`:null,p.next_action?`Próximo passo: ${p.next_action}`:null,'','1. Assumir','2. Ver contexto'].filter(Boolean).join('\n')
  return 'Atualização da Mugô.'
}

async function saveNotificationContext(admin:any,item:any,member:any,conversationId:string,messageId:string|null){
  const candidates=Array.isArray(item.payload?.candidate_items)?item.payload.candidate_items:[]
  const candidateType=candidates[0]?.type||null
  const result=await admin.from('internal_assistant_sessions').upsert({organization_id:item.organization_id,team_member_id:item.team_member_id,phone:normalizeBrazilianPhone(member.phone),state:candidates.length?'awaiting_selection':'idle',active_intent:candidateType==='task'?'TASK_BROWSE':candidateType==='conversation'?'CONVERSATION_BROWSE':'MAIN_MENU',context:{candidate_items:candidates,source_notification_id:item.id,source_notification_type:item.notification_type},pending_action:candidates.length?'select_item':null,pending_entity_type:candidateType==='task'?'crm_tasks':candidateType==='conversation'?'whatsapp_conversations':null,pending_entity_id:null,last_message_id:messageId,expires_at:new Date(Date.now()+30*60*1000).toISOString()},{onConflict:'organization_id,team_member_id,phone'})
  if(result.error)throw result.error
  await admin.from('whatsapp_conversations').update({last_outbound_at:new Date().toISOString()}).eq('id',conversationId).eq('organization_id',item.organization_id)
}

const templateEnvFor=(item:any)=>item.notification_type==='morning_digest'?'MUGO_TEAM_DIGEST_TEMPLATE_NAME':item.notification_type==='end_of_day_digest'?'MUGO_TEAM_HOURS_TEMPLATE_NAME':'MUGO_TEAM_ALERT_TEMPLATE_NAME'
const templateSummary=(item:any)=>item.notification_type==='morning_digest'?`${item.payload?.today?.length||0} para hoje e ${item.payload?.overdue?.length||0} atrasada(s)`:messageFor(item).replace(/\s+/g,' ').slice(0,500)

async function processItem(admin: any, item: any) {
  const operationalWindow=await getOperationalWindow(admin,item.organization_id)
  if(!operationalWindow.open)return false
  const claim = await admin.from('team_notification_outbox').update({ status: 'processing', attempts: Number(item.attempts || 0) + 1 }).eq('id', item.id).in('status', ['pending', 'failed']).select('id').maybeSingle()
  if (claim.error || !claim.data) return false
  try {
    const member = await admin.from('team_members').select('id,name,phone').eq('id', item.team_member_id).eq('organization_id', item.organization_id).eq('active', true).single()
    if (member.error) throw Object.assign(new Error('Membro interno não está mais ativo.'), { code: 'TEAM_MEMBER_INACTIVE', terminal: true })
    const destination = normalizeBrazilianPhone(member.data.phone)
    if (!destination) throw Object.assign(new Error('Telefone interno inválido.'), { code: 'DESTINATION_NOT_CONFIGURED', terminal: true })
    const connection = await admin.from('whatsapp_connections').select('id,phone_number_id,waba_id').eq('organization_id', item.organization_id).in('status', ['active', 'degraded']).order('updated_at', { ascending: false }).limit(1).maybeSingle()
    if (connection.error) throw connection.error
    if (!connection.data) throw Object.assign(new Error('Conexão WhatsApp da organização não está ativa.'), { code: 'CONNECTION_NOT_ACTIVE', terminal: true })
    const now = new Date().toISOString()
    const contact = await admin.from('whatsapp_contacts').upsert({ organization_id: item.organization_id, connection_id: connection.data.id, wa_id: destination, display_name: member.data.name, contact_type: 'internal', team_member_id: member.data.id, last_seen_at: now }, { onConflict: 'connection_id,wa_id' }).select('id').single()
    if (contact.error) throw contact.error
    const conversation = await admin.from('whatsapp_conversations').upsert({ organization_id: item.organization_id, connection_id: connection.data.id, contact_id: contact.data.id, wa_id: destination, status: 'open' }, { onConflict: 'connection_id,wa_id' }).select('id,service_window_expires_at').single()
    if (conversation.error) throw conversation.error
    const idempotencyKey = `team-notify:${item.id}`
    const prior = await admin.from('whatsapp_messages').select('id,provider_message_id,status').eq('connection_id', connection.data.id).eq('idempotency_key', idempotencyKey).maybeSingle()
    if (prior.error) throw prior.error
    if (prior.data?.provider_message_id) { await saveNotificationContext(admin,item,member.data,conversation.data.id,prior.data.id); await admin.from('team_notification_outbox').update({ status: 'completed', provider_message_id: prior.data.provider_message_id, processed_at: now, last_error: null }).eq('id', item.id); return true }
    if (prior.data && prior.data.status === 'queued') throw Object.assign(new Error('Existe tentativa reservada sem confirmação; envio não será repetido.'), { code: 'SEND_OUTCOME_UNKNOWN', terminal: true })
    const bodyText = messageFor(item,member.data.name)
    const withinWindow=Boolean(conversation.data.service_window_expires_at&&new Date(conversation.data.service_window_expires_at).getTime()>Date.now())
    let metaPayload:any={ messaging_product:'whatsapp',recipient_type:'individual',to:destination,type:'text',text:{preview_url:false,body:bodyText.slice(0,4000)} }
    let messageType='text',templateName:string|null=null,templateLanguage:string|null=null,templateComponents:any[]=[]
    if(!withinWindow){
      templateName=clean(Deno.env.get(templateEnvFor(item)),100);templateLanguage=clean(Deno.env.get('MUGO_TEAM_TEMPLATE_LANGUAGE')||'pt_BR',20)
      if(!templateName)throw Object.assign(new Error(`Configure ${templateEnvFor(item)} com um template aprovado.`),{code:'APPROVED_TEMPLATE_REQUIRED'})
      const stored=await admin.from('whatsapp_message_templates').select('name,status,is_active').eq('organization_id',item.organization_id).eq('waba_id',connection.data.waba_id).eq('name',templateName).eq('language',templateLanguage).maybeSingle()
      if(stored.error)throw stored.error
      if(!stored.data||String(stored.data.status).toUpperCase()!=='APPROVED'||stored.data.is_active===false)throw Object.assign(new Error(`O template ${templateName} não está aprovado e ativo.`),{code:'APPROVED_TEMPLATE_REQUIRED'})
      templateComponents=[{type:'body',parameters:[{type:'text',text:clean(member.data.name).split(' ')[0]||'time Mugô'},{type:'text',text:templateSummary(item)}]}]
      metaPayload={messaging_product:'whatsapp',recipient_type:'individual',to:destination,type:'template',template:{name:templateName,language:{code:templateLanguage},components:templateComponents}}
      messageType='template'
    }
    let reservation = prior.data
    if (!reservation) { const reserved = await admin.from('whatsapp_messages').insert({ organization_id: item.organization_id, connection_id: connection.data.id, conversation_id: conversation.data.id, idempotency_key: idempotencyKey, direction: 'out', message_type: messageType, status: 'queued', text_content: bodyText,template_name:templateName,template_language:templateLanguage,template_components:templateComponents }).select('id').single(); if (reserved.error) throw reserved.error; reservation = reserved.data }
    else await admin.from('whatsapp_messages').update({ status: 'queued', error_code: null, error_message: null }).eq('id', reservation.id)
    const token = Deno.env.get('META_ACCESS_TOKEN') || ''
    if (!token) throw Object.assign(new Error('Meta não configurada.'), { code: 'META_CONFIGURATION_MISSING', terminal: true })
    let response: Response
    try {
      response = await fetch(`https://graph.facebook.com/${Deno.env.get('GRAPH_API_VERSION') || 'v23.0'}/${connection.data.phone_number_id}/messages`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(metaPayload),
        signal: AbortSignal.timeout(20_000),
      })
    } catch { throw Object.assign(new Error('Resultado do envio desconhecido; verifique o histórico.'), { code: 'SEND_OUTCOME_UNKNOWN', terminal: true }) }
    const responseBody = await response.json().catch(() => ({}))
    if (!response.ok) { await admin.from('whatsapp_messages').update({ status: 'failed', failed_at: now, error_code: String(response.status), error_message: clean(responseBody?.error?.message, 500) }).eq('id', reservation.id); throw Object.assign(new Error(clean(responseBody?.error?.message) || `Meta respondeu ${response.status}.`), { code: response.status === 429 || response.status >= 500 ? 'META_TEMPORARY_ERROR' : 'META_SEND_FAILED', confirmed: true }) }
    const providerMessageId = clean(responseBody?.messages?.[0]?.id, 240)
    if (!providerMessageId) throw Object.assign(new Error('Meta não confirmou o envio.'), { code: 'SEND_OUTCOME_UNKNOWN', terminal: true })
    await admin.from('whatsapp_messages').update({ provider_message_id: providerMessageId, status: 'accepted', sent_at: now }).eq('id', reservation.id)
    await saveNotificationContext(admin,item,member.data,conversation.data.id,reservation.id)
    await admin.from('team_notification_outbox').update({ status: 'completed', provider_message_id: providerMessageId, processed_at: now, last_error: null }).eq('id', item.id)
    return true
  } catch (error: any) {
    const attempts = Number(item.attempts || 0) + 1
    const terminal = Boolean(error?.terminal) || attempts >= 6
    await admin.from('team_notification_outbox').update({ status: terminal ? 'dead_letter' : 'failed', next_attempt_at: new Date(Date.now() + Math.min(3600, 2 ** attempts * 30) * 1000).toISOString(), last_error: clean(error?.message, 500), processed_at: terminal ? new Date().toISOString() : null }).eq('id', item.id)
    return false
  }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405)
  const expected = Deno.env.get('TEAM_NOTIFICATION_WORKER_KEY') || ''
  if (!expected || request.headers.get('X-Team-Notification-Worker-Key') !== expected) return json({ ok: false, code: 'UNAUTHORIZED' }, 401)
  const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return json({ ok: false, code: 'CONFIGURATION_MISSING' }, 503)
  const admin = createClient(url, key, { auth: { persistSession: false } })
  await enqueueDigests(admin)
  await enqueueOperationalAlerts(admin)
  await enqueueHandoffSla(admin)
  const due = await admin.from('team_notification_outbox').select('*').in('status', ['pending', 'failed']).lte('next_attempt_at', new Date().toISOString()).order('created_at').limit(20)
  if (due.error) return json({ ok: false, code: 'QUEUE_READ_FAILED' }, 500)
  let processed = 0
  for (const item of due.data || []) if (await processItem(admin, item)) processed += 1
  return json({ ok: true, claimed: due.data?.length || 0, processed })
})
