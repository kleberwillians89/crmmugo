// Newsletter semanal automática.
//   Cron (X-Email-Worker-Key): atualiza feeds (a cada 6h) e, no dia/hora configurados, gera a edição da semana.
//   CRM (admin/manager): {action:'generate_now'|'approve'|'skip'|'refresh_feeds', edition_id?}
// O envio em si é feito pela função email-campaigns (campanha agendada).
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2'
import {generateStructured} from '../_shared/aiProvider.js'
import {extractSiteSignals} from '../_shared/prospectingCore.js'
import {CURATION_SCHEMA,FLASH_SCHEMA,balanceCandidates,buildCurationPrompt,expiryDue,extractArticleText,generationDue,parseFeed,reminderDue,renderNewsletterHtml,sendAtAfterApproval,validateCuration,weekStart} from '../_shared/newsletterCore.js'

const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-email-worker-key','Content-Type':'application/json'}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors})
const clean=(value:unknown,max=500)=>String(value??'').trim().slice(0,max)
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())

async function refreshFeeds(admin:any,org:string,force=false){
  const sources=await admin.from('newsletter_sources').select('*').eq('organization_id',org).eq('active',true)
  let added=0
  for(const source of sources.data||[]){
    if(!force&&source.last_fetched_at&&Date.now()-Date.parse(source.last_fetched_at)<6*3_600_000)continue
    try{
      const response=await fetch(source.url,{headers:{'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 MugoNewsletter/1.1','Accept':'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5','Accept-Language':'pt-BR,pt;q=0.9,en;q=0.8'},signal:AbortSignal.timeout(15_000)})
      if(!response.ok)throw new Error(`HTTP ${response.status}`)
      const items=parseFeed(await response.text(),{limit:25}).filter(item=>!item.published_at||Date.now()-Date.parse(item.published_at)<14*86_400_000)
      if(items.length){
        const rows=items.map(item=>({organization_id:org,source_id:source.id,url:item.url,title:item.title,excerpt:item.excerpt,source_name:source.name,category:source.category,published_at:item.published_at||new Date().toISOString()}))
        const saved=await admin.from('industry_news').upsert(rows,{onConflict:'organization_id,url',ignoreDuplicates:true}).select('id')
        added+=saved.data?.length||0
      }
      await admin.from('newsletter_sources').update({last_fetched_at:new Date().toISOString(),last_error:null}).eq('id',source.id)
    }catch(error:any){
      await admin.from('newsletter_sources').update({last_fetched_at:new Date().toISOString(),last_error:clean(error?.message||'falha',200)}).eq('id',source.id)
    }
  }
  return added
}

async function enrichShortExcerpts(admin:any,items:any[]){
  const short=items.filter((item:any)=>clean(item.excerpt,2000).length<220)
  await Promise.all(short.map(async(item:any)=>{
    try{
      const response=await fetch(item.url,{headers:{'User-Agent':'Mozilla/5.0 (compatible; MugoNewsletter/1.0)','Accept':'text/html'},redirect:'follow',signal:AbortSignal.timeout(8_000)})
      if(!response.ok)return
      const text=extractArticleText((await response.text()).slice(0,400_000))
      if(text.length>clean(item.excerpt,2000).length){item.excerpt=text;await admin.from('industry_news').update({excerpt:text}).eq('id',item.id)}
    }catch{/* sem página: fica com o trecho do feed */}
  }))
}

async function generateEdition(admin:any,settings:any,{force=false,themes=null,focus=null,newsIds=null}:{force?:boolean,themes?:string[]|null,focus?:string|null,newsIds?:string[]|null}={}){
  const org=settings.organization_id,week=weekStart()
  const existing=await admin.from('newsletter_editions').select('*').eq('organization_id',org).eq('week_start',week).maybeSingle()
  if(existing.data&&!force)return existing.data
  if(existing.data&&['approved','sent'].includes(existing.data.status))throw Object.assign(new Error('A edição desta semana já foi aprovada.'),{code:'ALREADY_APPROVED'})
  const picked=Array.isArray(newsIds)&&newsIds.length?newsIds:null
  if(!picked)await refreshFeeds(admin,org)
  const since=new Date(Date.now()-8*86_400_000).toISOString()
  // Temas da semana (escolhidos pelo time na tela ou o padrão da configuração); vazio = todos.
  const chosenThemes=[...new Set((themes&&themes.length?themes:(settings.themes||[])).map((theme:string)=>clean(theme,40)).filter(Boolean))]
  if(focus!=null)settings={...settings,focus:clean(focus,800)||settings.focus}
  settings={...settings,themes:chosenThemes}
  let newsQuery=admin.from('industry_news').select('id,url,title,excerpt,source_name,category,published_at,edition_id').eq('organization_id',org).gte('published_at',since)
  if(chosenThemes.length)newsQuery=newsQuery.in('category',chosenThemes)
  const [news,knowledge]=await Promise.all([
    newsQuery.order('published_at',{ascending:false}).limit(400),
    admin.from('ai_knowledge_entries').select('category,content').eq('organization_id',org).eq('active',true).limit(40),
  ])
  // no máximo 12 por fonte, para uma fonte barulhenta não dominar a seleção
  // e alterna entre temas, para cultura não sumir no meio de 100 notícias de marketing
  let candidates=balanceCandidates((news.data||[]).filter((item:any)=>!item.edition_id||item.edition_id===existing.data?.id),{perSource:12,max:60})
  if(picked){
    // O time escolheu as notícias nos cards: a IA só escreve, não escolhe.
    const rows=await admin.from('industry_news').select('id,url,title,excerpt,source_name,category,published_at,edition_id').eq('organization_id',org).in('id',picked)
    if(rows.error)throw rows.error
    const byId=new Map((rows.data||[]).map((row:any)=>[row.id,row]))
    candidates=picked.map(id=>byId.get(id)).filter((row:any)=>row&&(!row.edition_id||row.edition_id===existing.data?.id))
    if(candidates.length<3)throw Object.assign(new Error('Selecione pelo menos 3 notícias desta semana.'),{code:'NOT_ENOUGH_NEWS'})
  }
  if(candidates.length<3)throw Object.assign(new Error(chosenThemes.length?`Poucas notícias desta semana nos temas escolhidos (${chosenThemes.join(', ')}). Escolha mais temas ou atualize as fontes.`:'Poucas notícias novas nas fontes nesta semana.'),{code:'NOT_ENOUGH_NEWS'})
  // Feed com trecho curto (só título): abre a página da notícia e traz descrição + primeiros parágrafos,
  // para a IA resumir com conteúdo de verdade. Fica salvo, então cada notícia é buscada uma vez só.
  await enrichShortExcerpts(admin,candidates.slice(0,25))
  const count=picked?candidates.length:Number(settings.items_count||5)
  const previousUrls=force&&existing.data&&!picked?(existing.data.items||[]).map((item:any)=>item.url).filter(Boolean):[]
  const prompt=buildCurationPrompt({candidates,settings,count,knowledge:knowledge.data||[],previousUrls,picked:Boolean(picked)})
  const result=await generateStructured({system:prompt.system,user:prompt.user,schema:CURATION_SCHEMA,schemaName:'newsletter_edition',maxTokens:3000,timeoutMs:90_000})
  const edition=validateCuration(result.data,candidates,count)
  if(!edition)throw Object.assign(new Error('A IA não montou uma edição válida. Tente gerar de novo.'),{code:'AI_INVALID_OUTPUT'})

  const values={organization_id:org,week_start:week,status:'draft',subject:edition.subject,preheader:edition.preheader,intro:edition.intro,items:edition.items,linkedin_post:edition.linkedin_post,themes:chosenThemes,error_message:null,generated_at:new Date().toISOString()}
  const saved=existing.data
    ?await admin.from('newsletter_editions').update(values).eq('id',existing.data.id).select('*').single()
    :await admin.from('newsletter_editions').insert(values).select('*').single()
  if(saved.error)throw saved.error
  const ids=edition.items.map((item:any)=>item.news_id).filter(Boolean)
  if(existing.data)await admin.from('industry_news').update({edition_id:null}).eq('edition_id',existing.data.id)
  for(const item of edition.items)if(item.news_id)await admin.from('industry_news').update({edition_id:saved.data.id,summary_pt:item.summary_pt,impact_pt:item.impact_pt,segments:item.segments}).eq('id',item.news_id)

  await upsertCampaign(admin,settings,saved.data)
  const owner=await admin.from('commercial_settings').select('commercial_owner_id').eq('organization_id',org).maybeSingle()
  if(!settings.auto_send){
    await admin.from('crm_tasks').upsert({organization_id:org,title:'Aprovar a newsletter da semana (sai terça cedo)',status:'pending',priority:'high',due_date:today(),assigned_to:owner.data?.commercial_owner_id||null,task_type:'general',source:'automation',source_ref:`newsletter:${saved.data.id}`,notes:`${edition.subject}\nComercial → E-mail marketing → Newsletter automática.`},{onConflict:'organization_id,source_ref'})
  }else await approveEdition(admin,settings,saved.data,null)
  return {...saved.data,ids}
}

async function upsertCampaign(admin:any,settings:any,edition:any){
  const html=renderNewsletterHtml({template:settings.template_html,itemTemplate:settings.item_template_html,edition})
  const values={organization_id:edition.organization_id,name:`Newsletter ${edition.week_start.split('-').reverse().join('/')}`,subject:edition.subject||'',preheader:edition.preheader||null,html,from_name:settings.from_name||null,from_email:settings.from_email||null,reply_to:settings.reply_to||null,audience:settings.audience||{tags:[],sources:[]}}
  if(edition.campaign_id){
    const updated=await admin.from('email_campaigns').update(values).eq('id',edition.campaign_id).in('status',['draft','scheduled']).select('id').maybeSingle()
    if(updated.data)return edition.campaign_id
  }
  const created=await admin.from('email_campaigns').insert({...values,status:'draft'}).select('id').single()
  if(created.error)throw created.error
  await admin.from('newsletter_editions').update({campaign_id:created.data.id}).eq('id',edition.id)
  edition.campaign_id=created.data.id
  return created.data.id
}

async function approveEdition(admin:any,settings:any,edition:any,userId:string|null,sendNow=false){
  if(!['draft','failed'].includes(edition.status))throw Object.assign(new Error('Esta edição não está mais em rascunho.'),{code:'INVALID_STATE'})
  const campaignId=await upsertCampaign(admin,settings,edition)
  const when=sendNow?new Date():sendAtAfterApproval(settings)
  const scheduled=await admin.from('email_campaigns').update({status:'scheduled',scheduled_for:when.toISOString()}).eq('id',campaignId).select('id').single()
  if(scheduled.error)throw scheduled.error
  await admin.from('newsletter_editions').update({status:'approved',approved_by:userId,approved_at:new Date().toISOString()}).eq('id',edition.id)
  await admin.from('crm_tasks').update({status:'completed',completed_at:new Date().toISOString()}).eq('organization_id',edition.organization_id).eq('source_ref',`newsletter:${edition.id}`).in('status',['pending','in_progress'])
  return {campaign_id:campaignId,scheduled_for:when.toISOString()}
}

Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:cors})
  if(request.method!=='POST')return json({ok:false},405)
  const url=Deno.env.get('SUPABASE_URL')||'',service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',anon=Deno.env.get('SUPABASE_ANON_KEY')||''
  if(!url||!service)return json({ok:false,code:'CONFIGURATION_MISSING'},503)
  const admin=createClient(url,service,{auth:{persistSession:false}})
  const body=await request.json().catch(()=>({}))

  const workerKey=Deno.env.get('EMAIL_WORKER_KEY')||''
  if(workerKey&&request.headers.get('X-Email-Worker-Key')===workerKey){
    const configs=await admin.from('newsletter_settings').select('*').eq('enabled',true)
    const report:any[]=[]
    // A coleta roda para toda organização com fonte ativa, mesmo com a newsletter desligada: as notícias
    // também alimentam os ganchos da prospecção e a tela de fontes mostra se cada uma está funcionando.
    const enabledOrgs=new Set((configs.data||[]).map((row:any)=>row.organization_id))
    const sourceOrgs=await admin.from('newsletter_sources').select('organization_id').eq('active',true)
    for(const org of new Set<string>((sourceOrgs.data||[]).map((row:any)=>row.organization_id))){
      if(enabledOrgs.has(org))continue
      try{report.push({organization_id:org,added:await refreshFeeds(admin,org),newsletter:'disabled'})}catch{/* próxima rodada */}
    }
    for(const settings of configs.data||[]){
      try{
        const added=await refreshFeeds(admin,settings.organization_id)
        let generated=null
        if(generationDue(settings)){
          const existing=await admin.from('newsletter_editions').select('id,status,updated_at').eq('organization_id',settings.organization_id).eq('week_start',weekStart()).maybeSingle()
          // se falhou (ex.: poucas notícias), tenta de novo a cada 3h
          const retry=existing.data?.status==='failed'&&Date.now()-Date.parse(existing.data.updated_at)>3*3_600_000
          if(!existing.data||retry)generated=(await generateEdition(admin,settings,{force:retry})).id
        }
        const current=await admin.from('newsletter_editions').select('*').eq('organization_id',settings.organization_id).eq('week_start',weekStart()).maybeSingle()
        let reminded=false,expired=false
        if(current.data&&expiryDue(settings,current.data)){
          await admin.from('newsletter_editions').update({status:'skipped',error_message:'Pulada automaticamente: não foi aprovada a tempo.'}).eq('id',current.data.id).eq('status','draft')
          await admin.from('crm_tasks').update({status:'cancelled'}).eq('organization_id',settings.organization_id).eq('source_ref',`newsletter:${current.data.id}`).in('status',['pending','in_progress'])
          expired=true
        }else if(current.data&&reminderDue(settings,current.data)){
          // vira tarefa crítica de hoje: entra no topo do resumo diário que o time recebe no WhatsApp às 8h
          await admin.from('crm_tasks').update({title:'URGENTE — aprovar a newsletter antes do envio',priority:'critical',due_date:today()}).eq('organization_id',settings.organization_id).eq('source_ref',`newsletter:${current.data.id}`).in('status',['pending','in_progress'])
          await admin.from('newsletter_editions').update({reminded_at:new Date().toISOString()}).eq('id',current.data.id)
          reminded=true
        }
        report.push({organization_id:settings.organization_id,added,generated,reminded,expired})
      }catch(error:any){
        const week=weekStart(),current=await admin.from('newsletter_editions').select('id,status').eq('organization_id',settings.organization_id).eq('week_start',week).maybeSingle()
        if(!current.data)await admin.from('newsletter_editions').insert({organization_id:settings.organization_id,week_start:week,status:'failed',error_message:clean(error?.message,300)})
        else if(current.data.status==='failed')await admin.from('newsletter_editions').update({error_message:clean(error?.message,300)}).eq('id',current.data.id)
        report.push({organization_id:settings.organization_id,error:clean(error?.message,200)})
      }
    }
    return json({ok:true,report})
  }

  const authorization=request.headers.get('Authorization')||''
  if(!anon||!authorization)return json({ok:false,code:'UNAUTHORIZED'},401)
  const user=await createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}}).auth.getUser()
  if(user.error||!user.data.user)return json({ok:false,code:'UNAUTHORIZED'},401)
  const profile=await admin.from('profiles').select('organization_id,role,active').eq('id',user.data.user.id).single()
  if(profile.error||!profile.data.active||!['admin','manager'].includes(profile.data.role))return json({ok:false,code:'FORBIDDEN',message:'Só admin/gestor gerencia a newsletter.'},403)
  const org=profile.data.organization_id,action=clean(body.action,40)
  try{
    const settings=await admin.from('newsletter_settings').select('*').eq('organization_id',org).maybeSingle()
    const config=settings.data||{organization_id:org,items_count:5,send_weekday:2,send_time:'07:45'}
    if(action==='refresh_feeds')return json({ok:true,data:{added:await refreshFeeds(admin,org,true)}})
    if(action==='flash'){
      // Edição extra: uma notícia quente vira post + slide para o LinkedIn na hora (sem e-mail).
      let material:any=null
      const newsId=clean(body.news_id,60),link=clean(body.url,1000),note=clean(body.note,2000)
      if(newsId){const row=await admin.from('industry_news').select('title,excerpt,url,source_name').eq('organization_id',org).eq('id',newsId).single();if(row.error)throw row.error;material={titulo:row.data.title,trecho:row.data.excerpt,link:row.data.url,fonte:row.data.source_name}}
      else if(/^https?:\/\//.test(link)){
        const page=await fetch(link,{headers:{'User-Agent':'Mozilla/5.0 (compatible; MugoNewsletter/1.0)'},signal:AbortSignal.timeout(15_000)}).then(r=>r.ok?r.text():'').catch(()=>'')
        const signals=extractSiteSignals(page,{url:link})
        material={titulo:signals.title,trecho:signals.meta_description||signals.text_excerpt?.slice(0,1500),link,fonte:new URL(link).hostname.replace(/^www\./,'')}
      }
      if(!material&&!note)return json({ok:false,code:'INVALID',message:'Escolha uma notícia, cole um link ou descreva o que aconteceu.'},400)
      const knowledge=await admin.from('ai_knowledge_entries').select('content').eq('organization_id',org).eq('category','tom').eq('active',true).limit(3)
      const result=await generateStructured({schemaName:'flash_post',schema:FLASH_SCHEMA,maxTokens:1200,timeoutMs:45_000,
        system:`Você escreve para a página da Mugô (agência brasileira de marketing digital) no LinkedIn. Uma notícia importante acabou de sair. Escreva em português do Brasil, com resumo próprio (nunca copie frases), só com fatos do material, e o impacto prático para marcas e e-commerces.${knowledge.data?.length?`\nTom de voz: ${knowledge.data.map((k:any)=>k.content).join(' ')}`:''}`,
        user:JSON.stringify({material,observacao_do_time:note||undefined})})
      return json({ok:true,data:{...result.data,url:material?.link||null,source_name:material?.fonte||'',week_start:new Date().toISOString().slice(0,10)}})
    }
    if(action==='generate_now'){
      const existing=await admin.from('newsletter_editions').select('status').eq('organization_id',org).eq('week_start',weekStart()).maybeSingle()
      const themes=Array.isArray(body.themes)?body.themes.map((theme:unknown)=>clean(theme,40)).filter(Boolean).slice(0,20):null
      const newsIds:string[]|null=Array.isArray(body.news_ids)?[...new Set<string>(body.news_ids.map((id:unknown)=>clean(id,60)).filter((id:string)=>/^[0-9a-f-]{36}$/i.test(id)))].slice(0,8):null
      if(newsIds&&newsIds.length&&newsIds.length<3)return json({ok:false,code:'NOT_ENOUGH_NEWS',message:'Selecione pelo menos 3 notícias.'},400)
      return json({ok:true,data:await generateEdition(admin,{...config,auto_send:false},{force:Boolean(existing.data),themes,focus:typeof body.focus==='string'?body.focus:null,newsIds:newsIds&&newsIds.length?newsIds:null})})
    }
    const edition=await admin.from('newsletter_editions').select('*').eq('organization_id',org).eq('id',clean(body.edition_id,60)).single()
    if(edition.error)return json({ok:false,code:'NOT_FOUND',message:'Edição não encontrada.'},404)
    if(action==='approve')return json({ok:true,data:await approveEdition(admin,config,edition.data,user.data.user.id)})
    if(action==='approve_now'){
      const result=await approveEdition(admin,config,edition.data,user.data.user.id,true)
      // dispara o envio já (sem esperar o próximo minuto do cron)
      const key=Deno.env.get('EMAIL_WORKER_KEY')||''
      if(key)await fetch(`${url}/functions/v1/email-campaigns`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${service}`,'X-Email-Worker-Key':key},body:JSON.stringify({source:'newsletter-now'}),signal:AbortSignal.timeout(60_000)}).catch(()=>null)
      return json({ok:true,data:result})
    }
    if(action==='skip'){
      await admin.from('newsletter_editions').update({status:'skipped'}).eq('id',edition.data.id)
      if(edition.data.campaign_id)await admin.from('email_campaigns').update({status:'draft',scheduled_for:null}).eq('id',edition.data.campaign_id).eq('status','scheduled')
      return json({ok:true,data:{skipped:true}})
    }
    if(action==='rerender')return json({ok:true,data:{campaign_id:await upsertCampaign(admin,config,edition.data)}})
    return json({ok:false,code:'UNKNOWN_ACTION'},400)
  }catch(error:any){
    return json({ok:false,code:clean(error?.code||'NEWSLETTER_FAILED',60),message:clean(error?.message||'Falha na newsletter.',300)},500)
  }
})
