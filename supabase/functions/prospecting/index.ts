// Prospecção: pesquisa com IA, sequência de e-mail pelo Gmail do domínio secundário,
// detecção de resposta e conversão em lead. LinkedIn é sempre manual (só registramos).
//
// Chamadas:
//   - CRM (usuário logado): {action:'research'|'approve_email'|'stop_sequence'|'convert'|'send_test', prospect_ids?, prospect_id?, channel?}
//   - Cron (header X-Prospecting-Worker-Key): {action:'cron'} → pesquisa fila + respostas + envios
//
// Secrets: ANTHROPIC_API_KEY (ou OPENAI_API_KEY), PROSPECTING_WORKER_KEY,
//          GMAIL_SERVICE_ACCOUNT_JSON, GMAIL_SENDER
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2'
import {generateStructured,researchWithWebSearch} from '../_shared/aiProvider.js'
import {PROSPECT_RESEARCH_SCHEMA,buildResearchPrompt,extractSiteSignals,isValidEmail,normalizeResearch,personalize,planSequence,renderOutreachHtml} from '../_shared/prospectingCore.js'
import {buildMimeMessage,gmailAccessToken,gmailSend,gmailThreadStatus} from '../_shared/gmail.js'
import {convertProspectToLead} from '../_shared/prospectConversion.js'

const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-prospecting-worker-key','Content-Type':'application/json'}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors})
const clean=(value:unknown,max=500)=>String(value??'').trim().slice(0,max)
const OPERATORS=['admin','manager','operations','commercial']

async function activity(admin:any,org:string,prospectId:string,channel:string,type:string,content:string|null=null,metadata:any={}){
  await admin.from('prospect_activities').insert({organization_id:org,prospect_id:prospectId,channel,activity_type:type,content,metadata,created_by:null})
}

// ---------------------------------------------------------------- pesquisa
async function fetchSite(url:string){
  if(!url)return null
  const target=/^https?:\/\//i.test(url)?url:`https://${url}`
  const started=Date.now()
  try{
    const response=await fetch(target,{redirect:'follow',headers:{'User-Agent':'Mozilla/5.0 (compatible; MugoResearch/1.0)','Accept-Language':'pt-BR'},signal:AbortSignal.timeout(12_000)})
    if(!response.ok)return {url:target,error:`HTTP ${response.status}`}
    const html=(await response.text()).slice(0,600_000)
    return extractSiteSignals(html,{url:response.url||target,elapsedMs:Date.now()-started})
  }catch(error:any){return {url:target,error:clean(error?.name||'erro',60)}}
}
async function fetchCnpj(cnpj:string){
  const digits=String(cnpj||'').replace(/\D/g,'');if(digits.length!==14)return null
  try{
    const response=await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`,{signal:AbortSignal.timeout(10_000)});if(!response.ok)return null
    const data=await response.json()
    return {razao_social:data.razao_social,nome_fantasia:data.nome_fantasia,atividade:data.cnae_fiscal_descricao,porte:data.porte,abertura:data.data_inicio_atividade,municipio:data.municipio,uf:data.uf,situacao:data.descricao_situacao_cadastral,socios:(data.qsa||[]).slice(0,4).map((s:any)=>({nome:s.nome_socio,qualificacao:s.qualificacao_socio}))}
  }catch{return null}
}

async function researchOne(admin:any,prospect:any){
  const org=prospect.organization_id
  const claim=await admin.from('prospects').update({research_status:'running',research_attempts:Number(prospect.research_attempts||0)+1,research_error:null}).eq('id',prospect.id).in('research_status',['queued','failed','idle','done']).select('id').maybeSingle()
  if(claim.error||!claim.data)return false
  try{
    const [settings,knowledge,siteSignals,cnpjData]=await Promise.all([
      admin.from('outreach_settings').select('*').eq('organization_id',org).maybeSingle(),
      admin.from('ai_knowledge_entries').select('category,title,content').eq('organization_id',org).eq('active',true).limit(40),
      fetchSite(prospect.website),
      fetchCnpj(prospect.cnpj),
    ])
    const prompt=buildResearchPrompt({prospect,settings:settings.data||{},knowledge:knowledge.data||[],siteSignals,cnpjData})
    let raw
    if(Deno.env.get('ANTHROPIC_API_KEY'))raw=(await researchWithWebSearch({system:prompt.system,user:prompt.user,schema:PROSPECT_RESEARCH_SCHEMA,maxSearches:4})).data
    else raw=(await generateStructured({system:prompt.system,user:prompt.user,schema:PROSPECT_RESEARCH_SCHEMA,schemaName:'save_research',maxTokens:2500,timeoutMs:90_000,webSearch:true})).data
    const result=normalizeResearch(raw)
    const patch:any={
      research_status:'done',fit_score:result.fit_score,fit_reason:result.fit_reason,hook:result.hook,
      linkedin_note:result.linkedin_note,linkedin_message:result.linkedin_message,email_subject:result.email_subject,email_body:result.email_body,email_followups:result.followups,
      research:{summary:result.summary,signals:result.signals,decision_maker:result.decision_maker,site:siteSignals?{...siteSignals,text_excerpt:undefined}:null,cnpj:cnpjData,researched_at:new Date().toISOString()},
    }
    if(prospect.status==='new')patch.status='ready'
    if(!prospect.contact_name&&result.decision_maker.name){patch.contact_name=result.decision_maker.name;patch.contact_role=result.decision_maker.role||prospect.contact_role}
    if(!prospect.contact_linkedin_url&&result.decision_maker.linkedin_url)patch.contact_linkedin_url=result.decision_maker.linkedin_url
    const saved=await admin.from('prospects').update(patch).eq('id',prospect.id).eq('organization_id',org);if(saved.error)throw saved.error
    await activity(admin,org,prospect.id,'system','research_done',result.hook,{fit_score:result.fit_score})
    return true
  }catch(error:any){
    await admin.from('prospects').update({research_status:'failed',research_error:clean(error?.message||'Falha na pesquisa',400)}).eq('id',prospect.id)
    return false
  }
}

async function processResearchQueue(admin:any,limit=3,org?:string){
  let query=admin.from('prospects').select('*').eq('research_status','queued').order('updated_at').limit(limit)
  if(org)query=query.eq('organization_id',org)
  const queue=await query;if(queue.error)return 0
  let done=0;for(const prospect of queue.data||[])if(await researchOne(admin,prospect))done+=1
  return done
}

// ---------------------------------------------------------------- e-mail
async function suppressed(admin:any,org:string,email:string){
  const result=await admin.from('email_suppressions').select('email').eq('organization_id',org).eq('email',email.toLowerCase()).maybeSingle()
  return Boolean(result.data)
}

async function approveEmail(admin:any,org:string,prospectIds:string[]){
  const settings=await admin.from('outreach_settings').select('*').eq('organization_id',org).maybeSingle()
  const prospects=await admin.from('prospects').select('*').eq('organization_id',org).in('id',prospectIds)
  if(prospects.error)throw prospects.error
  const results:any[]=[]
  for(const prospect of prospects.data||[]){
    if(!isValidEmail(prospect.contact_email)){results.push({id:prospect.id,ok:false,reason:'E-mail do contato ausente ou inválido.'});continue}
    if(!clean(prospect.email_subject)||!clean(prospect.email_body)){results.push({id:prospect.id,ok:false,reason:'Gere ou escreva o e-mail antes de aprovar.'});continue}
    if(['do_not_contact','disqualified','replied','converted'].includes(prospect.status)||await suppressed(admin,org,prospect.contact_email)){results.push({id:prospect.id,ok:false,reason:'Contato bloqueado ou já respondeu.'});continue}
    const steps=planSequence({prospect,settings:settings.data||{}})
    const rows=steps.map(step=>({organization_id:org,prospect_id:prospect.id,step:step.step,subject:personalize(step.subject,prospect),body_text:personalize(step.body_text,prospect),scheduled_for:step.scheduled_for.toISOString(),status:'scheduled',attempts:0,error_message:null}))
    const saved=await admin.from('outreach_email_queue').upsert(rows,{onConflict:'prospect_id,step'})
    if(saved.error){results.push({id:prospect.id,ok:false,reason:saved.error.message});continue}
    await admin.from('prospects').update({email_state:'approved'}).eq('id',prospect.id)
    await activity(admin,org,prospect.id,'email','sequence_approved',null,{steps:rows.length,first_send:rows[0].scheduled_for})
    results.push({id:prospect.id,ok:true,steps:rows.length,first_send:rows[0].scheduled_for})
  }
  return results
}

async function stopSequence(admin:any,org:string,prospectId:string,reason='stopped'){
  await admin.from('outreach_email_queue').update({status:'cancelled'}).eq('organization_id',org).eq('prospect_id',prospectId).in('status',['scheduled','failed'])
  await admin.from('prospects').update({email_state:reason==='replied'?'replied':reason==='bounced'?'bounced':'stopped'}).eq('id',prospectId).eq('organization_id',org)
}

async function checkReplies(admin:any,org:string,sender:string,token:string){
  const watching=await admin.from('prospects').select('*').eq('organization_id',org).in('email_state',['sequence','approved']).not('gmail_thread_id','is',null).limit(60)
  let replies=0
  for(const prospect of watching.data||[]){
    const status=await gmailThreadStatus({threadId:prospect.gmail_thread_id,sender,token})
    if(status.bounced){
      await stopSequence(admin,org,prospect.id,'bounced')
      await admin.from('email_suppressions').upsert({organization_id:org,email:clean(prospect.contact_email,320).toLowerCase(),reason:'bounce'},{onConflict:'organization_id,email'})
      await activity(admin,org,prospect.id,'email','email_bounced')
    }else if(status.replied){
      await stopSequence(admin,org,prospect.id,'replied')
      await activity(admin,org,prospect.id,'email','email_reply',clean(status.replySnippet,1000))
      await convertProspectToLead(admin,{organizationId:org,prospect,channel:'email',snippet:status.replySnippet})
      replies+=1
    }
  }
  return replies
}

function inWindow(settings:any,now=new Date()){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',hourCycle:'h23',weekday:'short',hour:'2-digit',minute:'2-digit'}).formatToParts(now).map(p=>[p.type,p.value]))
  if(parts.weekday==='Sat'||parts.weekday==='Sun')return false
  const minutes=Number(parts.hour)*60+Number(parts.minute),toMin=(t:string,f:number)=>{const m=String(t||'').match(/^(\d{1,2}):(\d{2})/);return m?Number(m[1])*60+Number(m[2]):f}
  return minutes>=toMin(settings.send_window_start,510)&&minutes<toMin(settings.send_window_end,1080)
}
const startOfTodayBrt=()=>{const d=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());return new Date(`${d}T00:00:00-03:00`).toISOString()}

async function sendDue(admin:any,org:string,settings:any,sender:string,token:string){
  if(!inWindow(settings))return 0
  const sentToday=await admin.from('outreach_email_queue').select('id',{count:'exact',head:true}).eq('organization_id',org).eq('status','sent').gte('sent_at',startOfTodayBrt())
  let budget=Math.max(0,Number(settings.daily_email_limit||30)-Number(sentToday.count||0))
  if(budget<=0)return 0
  // no máximo 3 por execução (cron a cada 5 min) para espaçar os envios como uma pessoa faria
  const due=await admin.from('outreach_email_queue').select('*,prospects(*)').eq('organization_id',org).in('status',['scheduled','failed']).lte('scheduled_for',new Date().toISOString()).lt('attempts',4).order('scheduled_for').limit(Math.min(3,budget))
  let sent=0
  for(const row of due.data||[]){
    const prospect=row.prospects
    if(!prospect||['replied','converted','do_not_contact','disqualified'].includes(prospect.status)||['replied','bounced','stopped'].includes(prospect.email_state)||await suppressed(admin,org,prospect.contact_email)){await admin.from('outreach_email_queue').update({status:'cancelled'}).eq('id',row.id);continue}
    if(row.step>0&&!prospect.gmail_thread_id){await admin.from('outreach_email_queue').update({status:'cancelled',error_message:'Primeiro e-mail não foi enviado.'}).eq('id',row.id);continue}
    const claim=await admin.from('outreach_email_queue').update({status:'sending',attempts:Number(row.attempts||0)+1}).eq('id',row.id).in('status',['scheduled','failed']).select('id').maybeSingle()
    if(!claim.data)continue
    try{
      let inReplyTo:string|undefined
      if(row.step>0){
        const status=await gmailThreadStatus({threadId:prospect.gmail_thread_id,sender,token})
        if(status.replied||status.bounced){await admin.from('outreach_email_queue').update({status:'cancelled'}).eq('id',row.id);continue}
        inReplyTo=status.lastMessageId||undefined
      }
      const html=renderOutreachHtml({template:settings.email_template_html,signature:settings.signature_html,bodyText:row.body_text,prospect})
      const signatureText=clean(String(settings.signature_html||'').replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' '),600)
      const mime=buildMimeMessage({from:sender,fromName:settings.sender_name,to:prospect.contact_email,subject:row.subject,text:`${row.body_text}${signatureText?`\n\n${signatureText}`:''}`,html,inReplyTo,references:inReplyTo})
      const result=await gmailSend({mime,threadId:row.step>0?prospect.gmail_thread_id:undefined,token})
      await admin.from('outreach_email_queue').update({status:'sent',sent_at:new Date().toISOString(),gmail_message_id:result.id,error_message:null}).eq('id',row.id)
      await admin.from('prospects').update({gmail_thread_id:prospect.gmail_thread_id||result.threadId,email_state:'sequence',status:['new','ready'].includes(prospect.status)?'contacted':prospect.status,last_contact_at:new Date().toISOString()}).eq('id',prospect.id)
      await activity(admin,org,prospect.id,'email','email_sent',row.subject,{step:row.step})
      sent+=1
    }catch(error:any){
      await admin.from('outreach_email_queue').update({status:'failed',error_message:clean(error?.message,400),scheduled_for:new Date(Date.now()+30*60_000).toISOString()}).eq('id',row.id)
    }
  }
  return sent
}

async function runOutreach(admin:any){
  const sender=clean(Deno.env.get('GMAIL_SENDER'),320)
  const configs=await admin.from('outreach_settings').select('*').eq('email_enabled',true)
  if(configs.error||!configs.data?.length||!sender)return {replies:0,sent:0,skipped:!sender?'GMAIL_SENDER ausente':null}
  let token:string
  try{token=await gmailAccessToken()}catch(error:any){return {replies:0,sent:0,error:clean(error?.message,200)}}
  let replies=0,sent=0
  for(const settings of configs.data){
    replies+=await checkReplies(admin,settings.organization_id,sender,token)
    sent+=await sendDue(admin,settings.organization_id,settings,sender,token)
  }
  return {replies,sent}
}

// ---------------------------------------------------------------- servidor
Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:cors})
  if(request.method!=='POST')return json({ok:false},405)
  const url=Deno.env.get('SUPABASE_URL')||'',service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',anon=Deno.env.get('SUPABASE_ANON_KEY')||''
  if(!url||!service)return json({ok:false,code:'CONFIGURATION_MISSING'},503)
  const admin=createClient(url,service,{auth:{persistSession:false}})
  const body=await request.json().catch(()=>({}))
  const action=clean(body.action,40)

  const workerKey=Deno.env.get('PROSPECTING_WORKER_KEY')||''
  if(workerKey&&request.headers.get('X-Prospecting-Worker-Key')===workerKey){
    const researched=await processResearchQueue(admin,3)
    const outreach=await runOutreach(admin)
    return json({ok:true,researched,...outreach})
  }

  const authorization=request.headers.get('Authorization')||''
  if(!anon||!authorization)return json({ok:false,code:'UNAUTHORIZED'},401)
  const user=await createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}}).auth.getUser()
  if(user.error||!user.data.user)return json({ok:false,code:'UNAUTHORIZED'},401)
  const profile=await admin.from('profiles').select('organization_id,role,active').eq('id',user.data.user.id).single()
  if(profile.error||!profile.data.active||!OPERATORS.includes(profile.data.role))return json({ok:false,code:'FORBIDDEN',message:'Sem permissão para prospecção.'},403)
  const org=profile.data.organization_id
  const ids=(Array.isArray(body.prospect_ids)?body.prospect_ids:[body.prospect_id]).map((id:unknown)=>clean(id,60)).filter(Boolean).slice(0,50)

  try{
    if(action==='research'){
      if(!ids.length)return json({ok:false,code:'INVALID',message:'Selecione ao menos um prospect.'},400)
      const queued=await admin.from('prospects').update({research_status:'queued',research_error:null}).eq('organization_id',org).in('id',ids).neq('research_status','running')
      if(queued.error)throw queued.error
      // pesquisa até 2 na hora (resposta rápida na tela); o resto o cron processa
      const done=await processResearchQueue(admin,2,org)
      return json({ok:true,data:{queued:ids.length,done}})
    }
    if(action==='approve_email'){
      if(!ids.length)return json({ok:false,code:'INVALID',message:'Selecione ao menos um prospect.'},400)
      return json({ok:true,data:await approveEmail(admin,org,ids)})
    }
    if(action==='stop_sequence'){
      for(const id of ids)await stopSequence(admin,org,id)
      return json({ok:true,data:{stopped:ids.length}})
    }
    if(action==='convert'){
      const prospect=await admin.from('prospects').select('*').eq('organization_id',org).eq('id',ids[0]).single();if(prospect.error)throw prospect.error
      const channel=['linkedin','email','whatsapp','phone'].includes(clean(body.channel,20))?clean(body.channel,20):'linkedin'
      await stopSequence(admin,org,prospect.data.id,'replied')
      const result=await convertProspectToLead(admin,{organizationId:org,prospect:prospect.data,channel,snippet:clean(body.note,1000)})
      return json({ok:true,data:result})
    }
    if(action==='send_test'){
      // Manda o e-mail do prospect para a própria caixa de envio, para conferir o visual.
      const sender=clean(Deno.env.get('GMAIL_SENDER'),320)
      const [prospect,settings]=await Promise.all([admin.from('prospects').select('*').eq('organization_id',org).eq('id',ids[0]).single(),admin.from('outreach_settings').select('*').eq('organization_id',org).maybeSingle()])
      if(prospect.error)throw prospect.error
      const s=settings.data||{},token=await gmailAccessToken()
      const html=renderOutreachHtml({template:s.email_template_html,signature:s.signature_html,bodyText:personalize(prospect.data.email_body,prospect.data),prospect:prospect.data})
      await gmailSend({mime:buildMimeMessage({from:sender,fromName:s.sender_name,to:sender,subject:`[TESTE] ${personalize(prospect.data.email_subject,prospect.data)}`,text:personalize(prospect.data.email_body,prospect.data),html}),token})
      return json({ok:true,data:{sent_to:sender}})
    }
    return json({ok:false,code:'UNKNOWN_ACTION'},400)
  }catch(error:any){
    return json({ok:false,code:clean(error?.code||'PROSPECTING_FAILED',60),message:clean(error?.message||'Falha na prospecção.',300)},500)
  }
})
