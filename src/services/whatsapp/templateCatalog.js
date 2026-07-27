import { listStoredWhatsAppTemplates, syncWhatsAppTemplates } from '../data/whatsappRepository.js'
import { isTemplateAvailable } from './templateStatus.js'
export { isTemplateAvailable } from './templateStatus.js'

export const TEMPLATE_NAMES=Object.freeze(['mugo_alerta_pagamento_pendente','mugo_pagamento_confirmado','mugo_solicitar_comprovante','mugo_aviso_renovacao_contrato','mugo_agendamento_confirmado','mugo_boas_vindas_diagnostico_v1','hello_world'])
const definitions={
  mugo_alerta_pagamento_pendente:{display:'Alerta de pagamento pendente',purpose:'Cobrança',preview:'Olá, {{1}}. Tudo bem? Identificamos uma informação financeira referente aos serviços da Mugô que precisa da sua atenção. Para consultar os detalhes e as opções de pagamento, escolha uma das opções abaixo. Caso já tenha tratado esse assunto com nossa equipe, desconsidere esta mensagem.',buttons:['Consultar cobrança','Já realizei o pagamento'],footer:'',enabled:true},
  mugo_pagamento_confirmado:{display:'Pagamento confirmado',purpose:'Financeiro',preview:'Olá, {{1}}. Confirmamos o recebimento do seu pagamento referente aos serviços da Mugô. Agradecemos pela confiança e parceria. Se precisar de qualquer informação, nossa equipe está à disposição.',buttons:[],footer:'',enabled:false},
  mugo_solicitar_comprovante:{display:'Solicitar comprovante',purpose:'Financeiro',preview:'Olá, {{1}}. Tudo bem? Para concluirmos a conferência do pagamento referente aos serviços da Mugô, precisamos do comprovante da transação. Envie o arquivo nesta conversa ou fale com nossa equipe caso precise de ajuda.',buttons:[],footer:'',enabled:false},
  mugo_aviso_renovacao_contrato:{display:'Aviso de renovação',purpose:'Relacionamento',preview:'Olá, {{1}}. Tudo bem? Seu contrato de serviços com a Mugô está próximo do período de renovação. Queremos alinhar os próximos passos e garantir a continuidade do trabalho com tranquilidade.',buttons:[],footer:'',enabled:false},
  mugo_agendamento_confirmado:{display:'Agendamento confirmado',purpose:'Agenda',preview:'Olá, {{1}}. Seu atendimento com a equipe da Mugô está confirmado para {{2}}, às {{3}}. Caso precise ajustar o horário, escolha uma das opções abaixo.',buttons:[],footer:'',enabled:false},
  mugo_boas_vindas_diagnostico_v1:{display:'Boas-vindas e diagnóstico',purpose:'Novos leads',preview:'Olá {{cliente_nome}}! Aqui é a equipe da Mugô. Unimos tecnologia, consultoria e estratégia para destravar o potencial das marcas com automação e IA. Quer entender como podemos otimizar seus processos e resultados? Responda esta mensagem e comece sua jornada com a Mugô.',buttons:[],footer:'',enabled:false},
  hello_world:{display:'Template de teste da Meta',purpose:'Teste técnico',preview:'Template técnico padrão da Meta.',buttons:[],footer:'',enabled:false,technical:true},
}
let sessionCache=[],lastSync=null,inFlight=null
const key=item=>`${item.name}:${item.language||''}`
const component=(item,type)=>Array.isArray(item.components)?item.components.find(row=>String(row.type||'').toUpperCase()===type):null
const decorate=item=>{
  const known=definitions[item.name]||{},body=component(item,'BODY'),footer=component(item,'FOOTER'),buttons=component(item,'BUTTONS')?.buttons
  return {...known,...item,display:known.display||item.name,purpose:known.purpose||item.category||'Template da Meta',preview:body?.text||known.preview||'',footer:footer?.text||known.footer||'',buttons:Array.isArray(buttons)?buttons.map(button=>button.text||button.type).filter(Boolean):(known.buttons||[]),enabled:known.enabled??true,language:item.language||'pt_BR',quality:item.quality||item.quality_score||'UNKNOWN',lastSyncedAt:item.lastSyncedAt||item.last_synced_at||null,error:item.error||''}
}
const configuredFallback=()=>TEMPLATE_NAMES.map(name=>decorate({...definitions[name],name,language:'pt_BR',status:'SYNC_ERROR',category:'',quality:'UNKNOWN',lastSyncedAt:null,error:''}))
const mergeRows=(rows,includeFallback=false)=>{
  const incoming=(Array.isArray(rows)?rows:[]).map(decorate),byKey=new Map(incoming.map(item=>[key(item),item]))
  if(includeFallback)for(const fallback of configuredFallback())if(!byKey.has(key(fallback)))byKey.set(key(fallback),fallback)
  return [...byKey.values()].sort((a,b)=>a.name.localeCompare(b.name)||a.language.localeCompare(b.language))
}
export function getConfiguredTemplates(){return sessionCache.length?sessionCache:configuredFallback()}
export async function loadStoredTemplateStatuses({force=false}={}){
  const result=await listStoredWhatsAppTemplates({force})
  sessionCache=mergeRows(result?.templates,!result?.templates?.length)
  lastSync=result?.last_sync||lastSync
  return{templates:sessionCache,lastSync,source:'supabase'}
}
export async function refreshTemplateStatuses({force=false}={}){
  if(!force&&!isTemplateSyncStale())return{templates:getConfiguredTemplates(),lastSync,updated:sessionCache.filter(item=>item.status!=='SYNC_ERROR').length,failed:sessionCache.filter(item=>item.status==='SYNC_ERROR').length}
  if(inFlight)return inFlight
  inFlight=(async()=>{
    const previous=new Map(sessionCache.map(item=>[key(item),item])),now=new Date().toISOString()
    try {
      const result=await syncWhatsAppTemplates({force})
      const official=Array.isArray(result?.templates)?result.templates:[]
      sessionCache=mergeRows(official.map(item=>({...item,lastSyncedAt:result.last_sync||now,error:''})))
      lastSync=result.last_sync||now
    } catch(error) {
      const message=`${error.message}${error.requestId?` (protocolo ${error.requestId})`:''}`
      sessionCache=sessionCache.length?sessionCache.map(item=>({...item,error:message})):configuredFallback().map(item=>({...item,error:message}))
      if(!previous.size)lastSync=null
    }
    return{templates:sessionCache,lastSync,updated:sessionCache.filter(item=>item.status!=='SYNC_ERROR').length,failed:sessionCache.filter(item=>item.status==='SYNC_ERROR').length}
  })().finally(()=>{inFlight=null})
  return inFlight
}
export function isConfiguredTemplateAvailable(name,templates=sessionCache){return isTemplateAvailable(name,templates)}
export const getLastTemplateSync=()=>lastSync
export const isTemplateSyncStale=(maxAge=600000)=>!lastSync||Date.now()-new Date(lastSync).getTime()>maxAge
