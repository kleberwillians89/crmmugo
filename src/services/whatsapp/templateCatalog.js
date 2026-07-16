import { getTemplateStatus } from '../data/whatsappRepository'

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
export function getConfiguredTemplates(){return TEMPLATE_NAMES.map(name=>({...definitions[name],name,language:'pt_BR',status:'SYNC_ERROR',category:'',quality:'UNKNOWN',lastSyncedAt:null,error:'',...(sessionCache.find(item=>item.name===name)||{})}))}
export async function refreshTemplateStatuses({force=false}={}){
  if(!force&&!isTemplateSyncStale())return{templates:getConfiguredTemplates(),lastSync,updated:sessionCache.filter(item=>item.status!=='SYNC_ERROR').length,failed:sessionCache.filter(item=>item.status==='SYNC_ERROR').length}
  if(inFlight)return inFlight
  inFlight=(async()=>{
    const previous=new Map(sessionCache.map(item=>[item.name,item])),now=new Date().toISOString(),rows=[]
    let cursor=0
    async function worker(){while(cursor<TEMPLATE_NAMES.length){const name=TEMPLATE_NAMES[cursor++];try{rows.push({...definitions[name],...(await getTemplateStatus(name,{force})),name,lastSyncedAt:now,error:''})}catch(error){const valid=previous.get(name);rows.push(valid?{...valid,error:error.message,lastSyncedAt:valid.lastSyncedAt}:{...definitions[name],name,language:'pt_BR',status:'SYNC_ERROR',category:'',quality:'UNKNOWN',lastSyncedAt:now,error:error.message})}}}
    await Promise.all([worker(),worker(),worker()])
    sessionCache=TEMPLATE_NAMES.map(name=>rows.find(item=>item.name===name));lastSync=now
    return{templates:sessionCache,lastSync,updated:sessionCache.filter(item=>item.status!=='SYNC_ERROR').length,failed:sessionCache.filter(item=>item.status==='SYNC_ERROR').length}
  })().finally(()=>{inFlight=null})
  return inFlight
}
export function isTemplateAvailable(name,templates=sessionCache){const item=templates.find(template=>template.name===name);return item?.status==='APPROVED'&&item?.language==='pt_BR'}
export const getLastTemplateSync=()=>lastSync
export const isTemplateSyncStale=(maxAge=600000)=>!lastSync||Date.now()-new Date(lastSync).getTime()>maxAge
