import { AI_MAX_CONVERSATION_ITEMS, AI_MAX_QUESTION_LENGTH, AI_PROVIDER, AI_TIMEOUT_MS, canUseExternalAssistant } from '../../config/aiConfig.js'
import { dataProvider, getSupabaseClient } from '../../lib/supabase/client.js'
import { localBusinessAssistant } from './localBusinessAssistant.js'
import {getTemporalContext} from '../../lib/temporalIntelligence.js'

const friendlySources = {
  local: 'Baseado nos cálculos e dados registrados no CRM.',
  openai: 'Resposta elaborada pela Mugô Intelligence com base nos dados registrados no CRM.',
}

const friendlySourceList=(sources=[])=>{const text=sources.join(' ').toLowerCase(),result=[];if(text.includes('catálogo')||text.includes('catalogo'))result.push('Baseado no catálogo de serviços da Mugô.');if(/financeiro|recebimento|parcela|contrato/.test(text))result.push('Baseado nos contratos e recebimentos registrados no CRM.');return result}
const normalizeResult=(result,source)=>({answer:String(result.answer||result.text||'').trim(),source,sources:friendlySourceList(Array.isArray(result.sources)?result.sources:[]),intent:result.intent||result.intention,confidence:Number.isFinite(result.confidence)?result.confidence:source==='local'?100:undefined,suggestions:result.suggestions||[],structuredData:result.structuredData})
const timeout=()=>new Promise((_,reject)=>setTimeout(()=>reject(new Error('TIMEOUT')),AI_TIMEOUT_MS))
const telemetry=(provider,startedAt,success,code)=>{if(import.meta.env.DEV)console.info('[mugo-intelligence]',{provider,durationMs:Math.round(performance.now()-startedAt),success,code})}

async function functionError(error){try{const response=error?.context;if(response instanceof Response){const body=await response.clone().json();return body?.code||`HTTP_${response.status}`}}catch{return 'EDGE_ERROR'}return error?.message==='TIMEOUT'?'TIMEOUT':'EDGE_ERROR'}

export async function askMugoAssistant({question,crmContext={},conversation=[],userRole}) {
  const startedAt=performance.now()
  const clean=String(question||'').trim()
  if(!clean)return {answer:'Digite uma pergunta para continuar.',source:'local',sources:[friendlySources.local],suggestions:[]}
  if(clean.length>AI_MAX_QUESTION_LENGTH)return {answer:`A pergunta deve ter no máximo ${AI_MAX_QUESTION_LENGTH.toLocaleString('pt-BR')} caracteres.`,source:'local',sources:[friendlySources.local]}
  const localRaw=localBusinessAssistant(clean,crmContext)
  const local=normalizeResult(localRaw,'local')
  if(local.answer&&localRaw.handled){telemetry('local',startedAt,true);return {...local,sources:[friendlySources.local,...local.sources]}}
  if(!canUseExternalAssistant(dataProvider)){telemetry('local',startedAt,true,'NOT_RECOGNIZED');return {...local,answer:'Não consegui entender completamente. Você quer consultar metas, clientes, propostas, contratos, serviços ou financeiro?',sources:[friendlySources.local],suggestions:['Quanto falta para a meta?','Quais propostas estão paradas?','Quanto temos em aberto?']}}
  try{
    const safeConversation=conversation.slice(-AI_MAX_CONVERSATION_ITEMS).map((item)=>({question:String(item.question||'').slice(0,500),answer:String(item.answer||item.text||'').slice(0,700)}))
    const invocation=getSupabaseClient().functions.invoke('mugo-ai-assistant',{body:{question:clean,localContext:{intent:local.intent,confidence:local.confidence},temporalContext:getTemporalContext(),conversation:safeConversation,userRole}})
    const {data,error}=await Promise.race([invocation,timeout()])
    if(error)throw error
    if(!data?.answer)throw new Error(data?.code||'EMPTY_RESPONSE')
    telemetry('supabase',startedAt,true)
    return {...normalizeResult(data,'openai'),sources:[friendlySources.openai,...friendlySourceList(data.sources||[])]}
  }catch(error){
    const code=await functionError(error)
    const suffix={AI_DISABLED:'O assistente externo está desativado.',AI_MODEL_NOT_CONFIGURED:'O modelo de IA ainda não foi configurado.',AI_KEY_NOT_CONFIGURED:'A chave da IA ainda não foi configurada.',SESSION_EXPIRED:'Sua sessão expirou. Faça login novamente.',TIMEOUT:'O assistente externo demorou mais que o esperado.'}[code]||'O assistente externo está temporariamente indisponível.'
    telemetry('supabase',startedAt,false,code)
    return {...local,answer:`${suffix} Esta resposta foi calculada localmente. ${local.answer}`,sources:[friendlySources.local,...local.sources],suggestions:local.suggestions||[]}
  }
}

export async function testMugoAssistantConnection(){if(AI_PROVIDER!=='supabase')return {ok:false,detail:'VITE_AI_PROVIDER está configurado para modo local.'};try{const {data,error}=await getSupabaseClient().functions.invoke('mugo-ai-assistant',{body:{question:'Responda apenas: Mugô Intelligence conectada.',localContext:{diagnostic:true},conversation:[]}});if(error){const code=await functionError(error);return {ok:false,detail:{AI_DISABLED:'IA externa desativada.',AI_MODEL_NOT_CONFIGURED:'Modelo não configurado.',AI_KEY_NOT_CONFIGURED:'Chave não configurada.'}[code]||'Função indisponível ou sessão inválida.'}}return {ok:data?.answer?.includes('Mugô Intelligence conectada'),detail:data?.answer?.includes('Mugô Intelligence conectada')?'Função acessível, IA habilitada e resposta recebida.':'A função respondeu sem confirmar a conexão.'}}catch{return {ok:false,detail:'Não foi possível acessar a função.'}}}
