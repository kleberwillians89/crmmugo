// Inscrição pública na newsletter (verify_jwt = false). Usada pela página /news e /news/confirmar.
//   GET  ?action=config                → { pixel_id, enabled }
//   POST {action:'signup', ...form}     → grava a inscrição (pendente) e manda o e-mail de confirmação
//   POST {action:'confirm', token}      → confirma: vira contato com tag "newsletter", manda boas-vindas
//                                         e, se pediu contato, cria lead + oportunidade + tarefa para o comercial.
// Secrets usados: RESEND_API_KEY, EMAIL_FROM (fallback), NEWSLETTER_SITE_URL (padrão https://crm.mugoagencia.com.br/news),
// NEWSLETTER_ORG_ID (opcional; sem ele usa a única organização com newsletter configurada).
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2'
import {
  CONSENT_TEXT, CONTACT_CONSENT_TEXT, ERROR_MESSAGES, NEWSLETTER_TAG, attributionLabel, confirmUrl, confirmationAllowed,
  confirmationEmail, leadTaskNotes, tokenExpired, validateSignup, welcomeEmail,
} from '../_shared/newsletterSignupCore.js'
import {htmlToText, unsubscribeUrl} from '../_shared/emailMarketingCore.js'

const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Content-Type':'application/json'}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors})
const clean=(value:unknown,max=500)=>String(value??'').trim().slice(0,max)
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SUPABASE_URL=Deno.env.get('SUPABASE_URL')||''
const SITE_URL=(Deno.env.get('NEWSLETTER_SITE_URL')||'https://crm.mugoagencia.com.br/news').replace(/\/$/,'')
const LOGO_URL=`${SITE_URL}/mugo-logo.png`
const MAX_PER_IP_PER_HOUR=8
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())

async function sha256(text:string){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('')
}

async function resolveOrg(admin:any){
  const fixed=clean(Deno.env.get('NEWSLETTER_ORG_ID'),64)
  const query=admin.from('newsletter_settings').select('organization_id,signup_enabled,meta_pixel_id,from_name,from_email,reply_to')
  const result=fixed?await query.eq('organization_id',fixed).limit(1):await query.limit(2)
  if(result.error)throw result.error
  if(!fixed&&(result.data||[]).length!==1)return null
  return result.data?.[0]||null
}

function fromAddress(settings:any){
  if(settings?.from_email)return settings.from_name?`${clean(settings.from_name,120)} <${clean(settings.from_email,320)}>`:clean(settings.from_email,320)
  return clean(Deno.env.get('EMAIL_FROM'),320)
}

async function sendEmail(settings:any,to:string,mail:{subject:string,html:string,text?:string},headers:Record<string,string>={},idempotencyKey=''){
  const key=Deno.env.get('RESEND_API_KEY')||''
  if(!key)throw new Error('RESEND_API_KEY ausente')
  const from=fromAddress(settings);if(!from)throw new Error('Remetente não configurado')
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json',...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},
    body:JSON.stringify({from,to:[to],subject:mail.subject,html:mail.html,text:mail.text||htmlToText(mail.html),...(settings?.reply_to?{reply_to:clean(settings.reply_to,320)}:{}),...(Object.keys(headers).length?{headers}:{})}),
    signal:AbortSignal.timeout(20_000)})
  if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(clean(body?.message||`Resend ${response.status}`,200))}
}

async function createLead(admin:any,org:string,signup:any){
  const settings=await admin.from('commercial_settings').select('commercial_owner_id').eq('organization_id',org).maybeSingle()
  const ownerId=settings.data?.commercial_owner_id||null
  const a=signup.attribution||{}
  const label=clean(signup.company||signup.name,240)||signup.email
  const value={email:signup.email,phone:signup.phone,company:signup.company,interest:signup.interest,attribution:a}

  let clientId:string|null=null
  const existing=await admin.from('clients').select('id').eq('organization_id',org).ilike('email',signup.email).neq('status','archived').limit(1)
  clientId=existing.data?.[0]?.id||null
  if(!clientId){
    const inserted=await admin.from('clients').insert({organization_id:org,company_name:label,contact_name:clean(signup.name,240)||null,email:signup.email,phone:signup.phone?`+${signup.phone}`:null,lead_source:'SITE_NEWSLETTER',status:'lead',notes:leadTaskNotes(value)}).select('id').single()
    if(inserted.error)throw inserted.error
    clientId=inserted.data.id
  }
  const now=new Date().toISOString()
  const open=await admin.from('commercial_opportunities').select('id').eq('organization_id',org).eq('client_id',clientId).not('stage','in','(won,lost)').order('created_at',{ascending:false}).limit(1)
  let opportunityId=open.data?.[0]?.id||null
  if(opportunityId){
    await admin.from('commercial_opportunities').update({last_interaction_at:now,next_action:'Chamar no WhatsApp: pediu contato pelo site',next_action_at:now}).eq('id',opportunityId).eq('organization_id',org)
  }else{
    const opp=await admin.from('commercial_opportunities').insert({organization_id:org,client_id:clientId,assigned_to:ownerId,name:label,email:signup.email,source:'site_newsletter',
      campaign:a.utm_campaign||null,ad_name:a.utm_content||null,utm_source:a.utm_source||null,utm_medium:a.utm_medium||null,utm_campaign:a.utm_campaign||null,utm_content:a.utm_content||null,
      stage:'new_lead',temperature:'warm',temperature_reason:'Pediu contato ao se inscrever na newsletter.',lead_kind:'new_business',main_problem:clean(signup.interest,1000)||null,
      next_action:'Chamar no WhatsApp: pediu contato pelo site',next_action_at:now,last_interaction_at:now,metadata:{newsletter_signup_id:signup.id,phone:signup.phone||null,origin:attributionLabel(a)}}).select('id').single()
    if(opp.error)throw opp.error
    opportunityId=opp.data.id
  }
  const firstName=clean(signup.name,80).split(/\s+/)[0]||'lead do site'
  const title=`COMERCIAL — Falar com ${firstName}${signup.company?` (${clean(signup.company,60)})`:''} · pediu contato pelo site`
  const task=await admin.from('crm_tasks').upsert({organization_id:org,title,status:'pending',priority:'high',due_date:today(),assigned_to:ownerId,client_id:clientId,opportunity_id:opportunityId,task_type:'commercial',source:'automation',source_ref:`newsletter-lead:${signup.id}`,notes:leadTaskNotes(value)},{onConflict:'organization_id,source_ref'}).select('id,title,due_date').single()
  if(!task.error&&ownerId){
    const notified=await admin.from('team_notification_outbox').insert({organization_id:org,team_member_id:ownerId,notification_type:'operational_alert',idempotency_key:`task-assigned:${task.data.id}`,payload:{kind:'task_assigned',task_id:task.data.id,title:task.data.title,due_date:task.data.due_date,requester_name:'Site',candidate_items:[{index:1,type:'task',task_id:task.data.id,label:task.data.title,due_date:task.data.due_date}]}})
    if(notified.error&&notified.error.code!=='23505')console.log(JSON.stringify({event:'newsletter_lead_notify_failed',code:notified.error.code}))
  }
  return opportunityId
}

async function signup(admin:any,request:Request,body:any){
  const checked=validateSignup(body)
  if(!checked.ok){
    if((checked as any).bot)return json({ok:true})
    return json({ok:false,errors:checked.errors,message:checked.errors.map((e:string)=>(ERROR_MESSAGES as any)[e]).filter(Boolean)[0]||'Confere os campos.'},400)
  }
  const value=(checked as any).value
  const settings=await resolveOrg(admin)
  if(!settings||settings.signup_enabled===false)return json({ok:false,message:'Inscrições fechadas no momento.'},503)
  const org=settings.organization_id

  const ip=clean(request.headers.get('x-forwarded-for'),200).split(',')[0].trim()
  const ipHash=ip?await sha256(`${org}:${ip}:${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''}`):null
  if(ipHash){
    const recent=await admin.from('newsletter_signups').select('id',{count:'exact',head:true}).eq('ip_hash',ipHash).gte('created_at',new Date(Date.now()-3600_000).toISOString())
    if((recent.count||0)>=MAX_PER_IP_PER_HOUR)return json({ok:true})
  }

  const suppressed=await admin.from('email_suppressions').select('reason').eq('organization_id',org).eq('email',value.email).maybeSingle()
  if(suppressed.data&&suppressed.data.reason!=='unsubscribe')return json({ok:true})

  const contact=await admin.from('email_contacts').select('id,subscribed,tags').eq('organization_id',org).eq('email',value.email).maybeSingle()
  const alreadyIn=contact.data?.subscribed&&(contact.data.tags||[]).includes(NEWSLETTER_TAG)&&!suppressed.data
  const record={organization_id:org,email:value.email,name:value.name,consent_text:value.wants_contact?`${CONSENT_TEXT} ${CONTACT_CONSENT_TEXT}`:CONSENT_TEXT,consent_at:new Date().toISOString(),
    wants_contact:value.wants_contact,phone:value.phone,company:value.company,interest:value.interest,attribution:value.attribution,ip_hash:ipHash,user_agent:clean(request.headers.get('user-agent'),300)||null,updated_at:new Date().toISOString()}

  if(alreadyIn){
    // Já está na lista: não manda confirmação de novo. Se agora pediu contato, o comercial recebe o lead.
    const inserted=await admin.from('newsletter_signups').insert({...record,status:'confirmed',confirmed_at:new Date().toISOString(),contact_id:contact.data.id}).select('*').single()
    if(!inserted.error&&value.wants_contact){
      const opportunityId=await createLead(admin,org,inserted.data)
      await admin.from('newsletter_signups').update({opportunity_id:opportunityId}).eq('id',inserted.data.id)
    }
    return json({ok:true,already:true})
  }

  const pending=await admin.from('newsletter_signups').select('*').eq('organization_id',org).eq('email',value.email).eq('status','pending').order('created_at',{ascending:false}).limit(1)
  let row=pending.data?.[0]
  if(row&&!tokenExpired(row)){
    const updated=await admin.from('newsletter_signups').update({...record,attribution:Object.keys(value.attribution).length?value.attribution:row.attribution}).eq('id',row.id).select('*').single()
    if(updated.error)throw updated.error
    row=updated.data
  }else{
    const inserted=await admin.from('newsletter_signups').insert(record).select('*').single()
    if(inserted.error)throw inserted.error
    row=inserted.data
  }
  if(confirmationAllowed(row)){
    const mail=confirmationEmail({name:row.name,url:confirmUrl(SITE_URL,row.confirm_token),logoUrl:LOGO_URL})
    try{
      await sendEmail(settings,row.email,mail)
      const lastDay=row.confirmation_sent_at&&Date.now()-Date.parse(row.confirmation_sent_at)<24*3600_000
      await admin.from('newsletter_signups').update({confirmation_sent_at:new Date().toISOString(),confirmations_sent:(lastDay?Number(row.confirmations_sent||0):0)+1}).eq('id',row.id)
    }catch(error){
      console.log(JSON.stringify({event:'newsletter_confirmation_failed',message:clean((error as Error)?.message,200)}))
      return json({ok:false,message:'Não conseguimos enviar o e-mail agora. Tenta de novo em alguns minutos?'},502)
    }
  }
  return json({ok:true})
}

async function confirm(admin:any,body:any){
  const token=clean(body.token,64)
  if(!uuid.test(token))return json({ok:false,reason:'invalid'},400)
  const found=await admin.from('newsletter_signups').select('*').eq('confirm_token',token).maybeSingle()
  const signup=found.data
  if(!signup)return json({ok:false,reason:'invalid'},404)
  if(signup.status==='confirmed')return json({ok:true,already:true,name:signup.name,wants_contact:signup.wants_contact})
  if(tokenExpired(signup))return json({ok:false,reason:'expired'},410)
  const org=signup.organization_id
  const now=new Date().toISOString()

  const existing=await admin.from('email_contacts').select('id,name,tags,attribution,unsubscribe_token').eq('organization_id',org).eq('email',signup.email).maybeSingle()
  let contact=existing.data
  if(contact){
    const tags=[...new Set([...(contact.tags||[]),NEWSLETTER_TAG])]
    const attribution=contact.attribution&&Object.keys(contact.attribution).length?contact.attribution:signup.attribution
    const updated=await admin.from('email_contacts').update({subscribed:true,unsubscribed_at:null,tags,name:contact.name||signup.name,consent_at:signup.consent_at,consent_text:signup.consent_text,attribution,updated_at:now}).eq('id',contact.id).select('id,unsubscribe_token').single()
    if(updated.error)throw updated.error
    contact=updated.data
  }else{
    const inserted=await admin.from('email_contacts').insert({organization_id:org,email:signup.email,name:signup.name,source:'form',tags:[NEWSLETTER_TAG],subscribed:true,consent_at:signup.consent_at,consent_text:signup.consent_text,attribution:signup.attribution}).select('id,unsubscribe_token').single()
    if(inserted.error)throw inserted.error
    contact=inserted.data
  }
  // Quem tinha se descadastrado e voltou pela página está pedindo de novo: libera.
  await admin.from('email_suppressions').delete().eq('organization_id',org).eq('email',signup.email).eq('reason','unsubscribe')

  // Marca como confirmada antes dos efeitos extras: um segundo clique não duplica nada.
  const claimed=await admin.from('newsletter_signups').update({status:'confirmed',confirmed_at:now,contact_id:contact.id,updated_at:now}).eq('id',signup.id).eq('status','pending').select('id')
  if(!claimed.data?.length)return json({ok:true,already:true,name:signup.name,wants_contact:signup.wants_contact})

  if(signup.wants_contact){
    try{
      const opportunityId=await createLead(admin,org,signup)
      await admin.from('newsletter_signups').update({opportunity_id:opportunityId}).eq('id',signup.id)
    }catch(error){console.log(JSON.stringify({event:'newsletter_lead_failed',message:clean((error as Error)?.message,200)}))}
  }

  const settings=await admin.from('newsletter_settings').select('from_name,from_email,reply_to').eq('organization_id',org).maybeSingle()
  const unsubscribe=unsubscribeUrl(SUPABASE_URL,contact.unsubscribe_token)
  try{
    await sendEmail(settings.data,signup.email,welcomeEmail({name:signup.name,unsubscribeUrl:unsubscribe,logoUrl:LOGO_URL}),{'List-Unsubscribe':`<${unsubscribe}>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'},`welcome-${signup.id}`)
  }catch(error){console.log(JSON.stringify({event:'newsletter_welcome_failed',message:clean((error as Error)?.message,200)}))}

  return json({ok:true,name:signup.name,wants_contact:signup.wants_contact})
}

Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:cors})
  const admin=createClient(SUPABASE_URL,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false}})
  try{
    if(request.method==='GET'){
      const settings=await resolveOrg(admin)
      return json({ok:true,enabled:Boolean(settings&&settings.signup_enabled!==false),pixel_id:settings?.meta_pixel_id||null})
    }
    if(request.method!=='POST')return json({ok:false},405)
    const body=await request.json().catch(()=>({}))
    if(body?.action==='confirm')return await confirm(admin,body)
    return await signup(admin,request,body)
  }catch(error){
    console.log(JSON.stringify({event:'newsletter_signup_error',message:clean((error as Error)?.message,300)}))
    return json({ok:false,message:'Algo deu errado do nosso lado. Tenta de novo em instantes?'},500)
  }
})
