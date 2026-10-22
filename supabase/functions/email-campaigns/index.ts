// E-mail marketing pelo Resend — só para a base com relação/consentimento (email_contacts).
//   - CRM (admin/manager): {action:'audience_count'|'send_test'|'send_now', campaign_id, emails?}
//   - Cron (X-Email-Worker-Key): processa campanhas agendadas/em envio, em lotes de 100.
// Secrets: RESEND_API_KEY, EMAIL_WORKER_KEY, EMAIL_FROM (ex.: "Mugô <news@seudominio.com.br>")
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2'
import {htmlToText,matchesAudience,renderCampaignHtml,unsubscribeUrl} from '../_shared/emailMarketingCore.js'

const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-email-worker-key','Content-Type':'application/json'}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors})
const clean=(value:unknown,max=500)=>String(value??'').trim().slice(0,max)
const BATCH=100

function fromAddress(campaign:any){
  const fallback=clean(Deno.env.get('EMAIL_FROM'),320)
  if(campaign.from_email)return campaign.from_name?`${clean(campaign.from_name,120)} <${clean(campaign.from_email,320)}>`:clean(campaign.from_email,320)
  return fallback
}

async function resendBatch(payload:any[]){
  const key=Deno.env.get('RESEND_API_KEY')||'';if(!key)throw Object.assign(new Error('RESEND_API_KEY ausente.'),{code:'RESEND_NOT_CONFIGURED'})
  const response=await fetch('https://api.resend.com/emails/batch',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(30_000)})
  const body=await response.json().catch(()=>({}))
  if(!response.ok)throw Object.assign(new Error(clean(body?.message||`Resend respondeu ${response.status}`,300)),{code:response.status===429||response.status>=500?'RESEND_TEMPORARY':'RESEND_FAILED'})
  return (body?.data||[]) as {id:string}[]
}

function buildEmail(campaign:any,recipient:{email:string,name?:string|null,token:string},baseUrl:string){
  const unsubscribe=unsubscribeUrl(baseUrl,recipient.token)
  const html=renderCampaignHtml(campaign.html,{name:recipient.name||'',email:recipient.email,unsubscribe})
  return {
    from:fromAddress(campaign),to:[recipient.email],subject:clean(campaign.subject,300),html,text:htmlToText(html),
    ...(campaign.reply_to?{reply_to:clean(campaign.reply_to,320)}:{}),
    headers:{'List-Unsubscribe':`<${unsubscribe}>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'},
  }
}

async function eligibleContacts(admin:any,campaign:any){
  const [contacts,suppressions]=await Promise.all([
    admin.from('email_contacts').select('id,email,name,tags,source,subscribed,unsubscribe_token').eq('organization_id',campaign.organization_id).eq('subscribed',true).limit(20000),
    admin.from('email_suppressions').select('email').eq('organization_id',campaign.organization_id).limit(50000),
  ])
  if(contacts.error)throw contacts.error
  const blocked=new Set((suppressions.data||[]).map((row:any)=>row.email))
  return (contacts.data||[]).filter((contact:any)=>!blocked.has(contact.email)&&matchesAudience(contact,campaign.audience||{}))
}

async function refreshStats(admin:any,campaignId:string){
  const rows=await admin.from('email_campaign_recipients').select('status').eq('campaign_id',campaignId).limit(50000)
  const stats:any={recipients:0,sent:0,delivered:0,opened:0,clicked:0,bounced:0,complained:0,failed:0}
  for(const row of rows.data||[]){
    stats.recipients+=1
    const s=row.status
    if(['sent','delivered','opened','clicked'].includes(s))stats.sent+=1
    if(['delivered','opened','clicked'].includes(s))stats.delivered+=1
    if(['opened','clicked'].includes(s))stats.opened+=1
    if(s==='clicked')stats.clicked+=1
    if(s==='bounced')stats.bounced+=1
    if(s==='complained')stats.complained+=1
    if(s==='failed')stats.failed+=1
  }
  await admin.from('email_campaigns').update({stats}).eq('id',campaignId)
  return stats
}

async function processCampaigns(admin:any,baseUrl:string){
  const now=new Date().toISOString()
  const campaigns=await admin.from('email_campaigns').select('*').or(`status.eq.sending,and(status.eq.scheduled,scheduled_for.lte.${now})`).limit(5)
  if(campaigns.error)return {error:campaigns.error.message}
  let sent=0
  for(const campaign of campaigns.data||[]){
    if(campaign.status==='scheduled'){
      const claim=await admin.from('email_campaigns').update({status:'sending'}).eq('id',campaign.id).eq('status','scheduled').select('id').maybeSingle()
      if(!claim.data)continue
      const contacts=await eligibleContacts(admin,campaign)
      for(let i=0;i<contacts.length;i+=500){
        const chunk=contacts.slice(i,i+500).map((contact:any)=>({organization_id:campaign.organization_id,campaign_id:campaign.id,contact_id:contact.id,email:contact.email,status:'queued'}))
        await admin.from('email_campaign_recipients').upsert(chunk,{onConflict:'campaign_id,email',ignoreDuplicates:true})
      }
    }
    // até 5 lotes (500 e-mails) por execução
    for(let round=0;round<5;round+=1){
      const queued=await admin.from('email_campaign_recipients').select('id,email,contact_id,email_contacts(name,unsubscribe_token,subscribed)').eq('campaign_id',campaign.id).eq('status','queued').limit(BATCH)
      if(queued.error||!queued.data?.length)break
      const sendable=queued.data.filter((row:any)=>row.email_contacts?.subscribed!==false&&row.email_contacts?.unsubscribe_token)
      const skipped=queued.data.filter((row:any)=>!sendable.includes(row))
      if(skipped.length)await admin.from('email_campaign_recipients').update({status:'skipped'}).in('id',skipped.map((row:any)=>row.id))
      if(!sendable.length)continue
      try{
        const ids=await resendBatch(sendable.map((row:any)=>buildEmail(campaign,{email:row.email,name:row.email_contacts?.name,token:row.email_contacts.unsubscribe_token},baseUrl)))
        await Promise.all(sendable.map((row:any,index:number)=>admin.from('email_campaign_recipients').update({status:'sent',resend_id:ids[index]?.id||null}).eq('id',row.id)))
        sent+=sendable.length
      }catch(error:any){
        if(error?.code==='RESEND_TEMPORARY')break
        await admin.from('email_campaign_recipients').update({status:'failed',error_message:clean(error?.message,300)}).in('id',sendable.map((row:any)=>row.id))
      }
    }
    const remaining=await admin.from('email_campaign_recipients').select('id',{count:'exact',head:true}).eq('campaign_id',campaign.id).eq('status','queued')
    if(!remaining.count)await admin.from('email_campaigns').update({status:'sent',sent_at:new Date().toISOString()}).eq('id',campaign.id)
    await refreshStats(admin,campaign.id)
  }
  return {sent}
}

Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:cors})
  if(request.method!=='POST')return json({ok:false},405)
  const url=Deno.env.get('SUPABASE_URL')||'',service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',anon=Deno.env.get('SUPABASE_ANON_KEY')||''
  if(!url||!service)return json({ok:false,code:'CONFIGURATION_MISSING'},503)
  const admin=createClient(url,service,{auth:{persistSession:false}})
  const workerKey=Deno.env.get('EMAIL_WORKER_KEY')||''
  if(workerKey&&request.headers.get('X-Email-Worker-Key')===workerKey)return json({ok:true,...await processCampaigns(admin,url)})

  const authorization=request.headers.get('Authorization')||''
  if(!anon||!authorization)return json({ok:false,code:'UNAUTHORIZED'},401)
  const user=await createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}}).auth.getUser()
  if(user.error||!user.data.user)return json({ok:false,code:'UNAUTHORIZED'},401)
  const profile=await admin.from('profiles').select('organization_id,role,active').eq('id',user.data.user.id).single()
  if(profile.error||!profile.data.active||!['admin','manager'].includes(profile.data.role))return json({ok:false,code:'FORBIDDEN',message:'Só admin/gestor envia campanhas.'},403)
  const org=profile.data.organization_id
  const body=await request.json().catch(()=>({}))
  const action=clean(body.action,40)
  try{
    const campaign=await admin.from('email_campaigns').select('*').eq('organization_id',org).eq('id',clean(body.campaign_id,60)).single()
    if(campaign.error)return json({ok:false,code:'NOT_FOUND',message:'Campanha não encontrada.'},404)
    if(action==='audience_count')return json({ok:true,data:{count:(await eligibleContacts(admin,campaign.data)).length}})
    if(!clean(campaign.data.subject)||!clean(campaign.data.html))return json({ok:false,code:'INCOMPLETE',message:'Preencha assunto e HTML antes de enviar.'},400)
    if(!fromAddress(campaign.data))return json({ok:false,code:'INCOMPLETE',message:'Defina o remetente (ou o secret EMAIL_FROM).'},400)
    if(action==='send_test'){
      const emails=(Array.isArray(body.emails)?body.emails:[]).map((e:unknown)=>clean(e,320).toLowerCase()).filter((e:string)=>/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)).slice(0,5)
      if(!emails.length)return json({ok:false,code:'INVALID',message:'Informe ao menos um e-mail de teste.'},400)
      await resendBatch(emails.map((email:string)=>({...buildEmail(campaign.data,{email,name:'Teste',token:'teste'},url),subject:`[TESTE] ${clean(campaign.data.subject,280)}`})))
      return json({ok:true,data:{sent_to:emails}})
    }
    if(action==='send_now'){
      if(!['draft','scheduled'].includes(campaign.data.status))return json({ok:false,code:'INVALID_STATE',message:'Esta campanha já foi enviada.'},409)
      await admin.from('email_campaigns').update({status:'scheduled',scheduled_for:new Date().toISOString()}).eq('id',campaign.data.id)
      return json({ok:true,data:await processCampaigns(admin,url)})
    }
    if(action==='refresh_stats')return json({ok:true,data:await refreshStats(admin,campaign.data.id)})
    return json({ok:false,code:'UNKNOWN_ACTION'},400)
  }catch(error:any){
    return json({ok:false,code:clean(error?.code||'EMAIL_FAILED',60),message:clean(error?.message||'Falha no e-mail marketing.',300)},500)
  }
})
