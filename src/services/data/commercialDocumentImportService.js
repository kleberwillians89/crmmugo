import { db, isSupabaseProvider, legacyUnavailable, organizationId, unwrap } from './provider'
import { confirmationsForDocument } from '../../lib/commercialDocumentReview'

export const TEMP_DOCUMENT_BUCKET='crm-documents-temp'
const FINAL_DOCUMENT_BUCKET='crm-documents'
const allowedTypes=['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']
const safeName=(name)=>name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9._-]/g,'-')
const normalize=(value)=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\D/g,'')
const valueOf=(field)=>field?.value??null
const cleanRecord=(record)=>Object.fromEntries(Object.entries(record).filter(([,value])=>value!==''&&value!==undefined))
const serviceFields=['service_name','service_category','billing_type','quantity','unit_price','monthly_value','one_time_value']
const pick=(record,keys)=>Object.fromEntries(Object.entries(record).filter(([key])=>keys.includes(key)))
const sha256=async(file)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))).map((byte)=>byte.toString(16).padStart(2,'0')).join('')

export function validateCommercialFile(file){
  if(!file||!allowedTypes.includes(file.type)||file.size>20*1024*1024)throw new Error('Use PDF, DOC ou DOCX com até 20 MB.')
}

export async function stageCommercialDocument(file){
  if(!isSupabaseProvider())return legacyUnavailable('Análise inteligente de documentos')
  validateCommercialFile(file)
  const client=db(),oid=await organizationId(),{data:{user}}=await client.auth.getUser()
  if(!user)throw new Error('Sua sessão expirou. Faça login novamente.')
  const path=`${oid}/${user.id}/${crypto.randomUUID()}-${safeName(file.name)}`
  unwrap(await client.storage.from(TEMP_DOCUMENT_BUCKET).upload(path,file,{cacheControl:'0',upsert:false}))
  try{
    return unwrap(await client.from('document_analyses').insert({organization_id:oid,user_id:user.id,temp_path:path,file_name:file.name,mime_type:file.type,file_size:file.size,content_hash:await sha256(file)}).select().single())
  }catch(error){await client.storage.from(TEMP_DOCUMENT_BUCKET).remove([path]);throw error}
}

export async function analyzeCommercialDocument(analysisId){
  const {data,error}=await db().functions.invoke('extract-commercial-document',{body:{analysisId}})
  if(error){let message='Não foi possível analisar o documento.';try{const body=await error.context?.clone?.().json();message=body?.message||message}catch{ /* resposta sem JSON controlado */ }throw new Error(message,{cause:error})}
  if(!data?.analysisId)throw new Error(data?.message||'A análise não retornou dados utilizáveis.')
  return data
}

export async function cancelCommercialDocument(analysis,{eventType='document_import_cancelled'}={}){
  if(!analysis)return
  const client=db(),{data:{user}}=await client.auth.getUser()
  await client.storage.from(analysis.temp_bucket||TEMP_DOCUMENT_BUCKET).remove([analysis.temp_path])
  await client.from('document_analyses').update({status:'cancelled',extracted_data:null}).eq('id',analysis.id)
  await client.from('commercial_events').insert({organization_id:analysis.organization_id,event_type:eventType,title:'Importação de documento cancelada',description:analysis.file_name,new_value:{analysis_id:analysis.id,file_name:analysis.file_name},created_by:user?.id})
}

export async function findCommercialDuplicates(result,analysis){
  const client=db(),clientData=result.extractedData.client,proposal=result.extractedData.proposal,contract=result.extractedData.contract
  const company=valueOf(clientData.company_name),document=normalize(valueOf(clientData.document_number)),email=String(valueOf(clientData.email)||'').toLowerCase(),phone=normalize(valueOf(clientData.phone))
  const {data:clients=[]}=await client.from('clients').select('id,company_name,trade_name,document_number,email,phone').limit(500)
  const clientMatches=clients.map((item)=>({item,reasons:[document&&normalize(item.document_number)===document?'Documento':null,company&&item.company_name?.toLowerCase()===company.toLowerCase()?'Empresa':null,email&&item.email?.toLowerCase()===email?'E-mail':null,phone&&normalize(item.phone)===phone?'Telefone':null].filter(Boolean)})).filter((row)=>row.reasons.length)
  const [documentQuery,hashQuery]=await Promise.all([client.from('documents').select('id,file_name,proposal_id,contract_id').eq('file_name',analysis.file_name),client.from('document_analyses').select('id,file_name,confirmed_document_id').eq('content_hash',analysis.content_hash).eq('status','confirmed').neq('id',analysis.id)])
  let entityMatches
  if(result.documentType==='proposal'){
    const {data=[]}=await client.from('proposals').select('id,proposal_number,title,sent_at,setup_value,monthly_value,total_value,client_id').limit(500)
    entityMatches=data.map((item)=>({item,reasons:[valueOf(proposal.proposal_number)&&item.proposal_number===valueOf(proposal.proposal_number)?'Número':null,valueOf(proposal.title)&&item.title?.toLowerCase()===String(valueOf(proposal.title)).toLowerCase()?'Título':null,valueOf(proposal.sent_at)&&item.sent_at===valueOf(proposal.sent_at)?'Data':null,valueOf(proposal.total_value)!=null&&Number(item.total_value)===Number(valueOf(proposal.total_value))?'Valor':null].filter(Boolean)})).filter((row)=>row.reasons.length>=2||row.reasons.includes('Número'))
  }else{
    const {data=[]}=await client.from('contracts').select('id,contract_number,start_date,end_date,setup_value,monthly_value,total_value,client_id').limit(500)
    entityMatches=data.map((item)=>({item,reasons:[valueOf(contract.contract_number)&&item.contract_number===valueOf(contract.contract_number)?'Número':null,valueOf(contract.start_date)&&item.start_date===valueOf(contract.start_date)?'Início':null,valueOf(contract.end_date)&&item.end_date===valueOf(contract.end_date)?'Fim':null,valueOf(contract.total_value)!=null&&Number(item.total_value)===Number(valueOf(contract.total_value))?'Valor':null].filter(Boolean)})).filter((row)=>row.reasons.length>=2||row.reasons.includes('Número'))
  }
  const {data:relatedProposals=[]}=await client.from('proposals').select('id,title,client_id,status').order('created_at',{ascending:false}).limit(250)
  const files=[...(hashQuery.data||[]).map((item)=>({item,reasons:['Conteúdo idêntico']})),...(documentQuery.data||[]).map((item)=>({item,reasons:['Arquivo com o mesmo nome']}))]
  const confirmed=Boolean(hashQuery.data?.length||entityMatches.some((row)=>row.reasons.includes('Número')))
  return {clientMatches,entityMatches,files,relatedProposals,classification:confirmed?'duplicidade confirmada':entityMatches.length||files.length||clientMatches.length?'possível duplicidade':'sem conflito'}
}

function extractedValues(section){return Object.fromEntries(Object.entries(section||{}).map(([key,field])=>[key,valueOf(field)]))}
async function resolveTeamMemberId(client,organizationId,name){if(!name)return null;const members=unwrap(await client.from('team_members').select('id,name').eq('organization_id',organizationId).eq('active',true));const normalized=String(name).trim().toLocaleLowerCase('pt-BR');return members.find((member)=>member.name.trim().toLocaleLowerCase('pt-BR')===normalized)?.id||null}

export async function confirmCommercialDocumentImport({analysis,result,reviewed,clientAction,clientId,entityAction,entityId,relatedProposalId,confirmations,onProgress=()=>{}}){
  if(!isSupabaseProvider())return legacyUnavailable('Importação comercial')
  if(entityAction==='cancel')throw new Error('Importação cancelada.')
  const required=confirmationsForDocument(result.documentType).map(([key])=>key)
  if(required.some((key)=>!confirmations[key]))throw new Error('Confirme explicitamente todos os campos sensíveis antes de importar.')
  const client=db(),oid=analysis.organization_id,{data:{user}}=await client.auth.getUser(),created={client:null,proposal:null,contract:null,document:null,finalPath:null,servicesTable:null},type=result.documentType
  let stage='cliente'
  try{
    onProgress('Importando cliente')
    if(type==='amendment'&&entityAction!=='link')throw new Error('Vincule o aditivo a um contrato existente antes de confirmar.')
    let resolvedClientId=clientId,proposalId=null,contractId=null
    if(entityAction==='link'&&type!=='other'){
      if(!entityId)throw new Error('Selecione o registro existente que receberá o documento.')
      const table=type==='proposal'?'proposals':'contracts'
      const existing=unwrap(await client.from(table).select('id,client_id').eq('id',entityId).single())
      resolvedClientId=existing.client_id
      if(type==='proposal')proposalId=existing.id
      else contractId=existing.id
    }else if(clientAction==='create'){
      const values=cleanRecord({...extractedValues(reviewed.client),status:'lead',organization_id:oid,created_by:user?.id,updated_by:user?.id})
      if(!values.company_name)throw new Error('Informe a empresa antes de confirmar a importação.')
      created.client=unwrap(await client.from('clients').insert(values).select().single());resolvedClientId=created.client.id
    }
    if(!resolvedClientId)throw new Error('Selecione ou crie o cliente antes de confirmar.')
    if(type==='other'){
      proposalId=null;contractId=null
    }else if(entityAction==='link'){
      // O registro e seu cliente já foram validados acima pela sessão e pelo RLS.
    }else if(type==='proposal'){
      stage='proposta';onProgress('Importando proposta')
      const extractedProposal=extractedValues(reviewed.proposal),responsibleId=await resolveTeamMemberId(client,oid,extractedProposal.responsible)
      delete extractedProposal.responsible
      const proposal=cleanRecord({...extractedProposal,responsible_id:responsibleId,organization_id:oid,client_id:resolvedClientId,created_by:user?.id,updated_by:user?.id})
      proposal.title=proposal.title||`Proposta importada — ${analysis.file_name}`
      proposal.status=proposal.status||'sent'
      created.proposal=unwrap(await client.from('proposals').insert(proposal).select().single());proposalId=created.proposal.id
      stage='serviços';onProgress('Vinculando serviços')
      const services=(reviewed.services||[]).map((service)=>cleanRecord({...pick(extractedValues(service),serviceFields),organization_id:oid,proposal_id:proposalId})).filter((service)=>service.service_name)
      if(services.length){created.servicesTable='proposal_services';unwrap(await client.from('proposal_services').insert(services))}
    }else if(type!=='amendment'){
      stage='contrato';onProgress('Importando contrato')
      const linkedProposal=relatedProposalId?unwrap(await client.from('proposals').select('responsible_id').eq('id',relatedProposalId).single()):null
      const contract=cleanRecord({...extractedValues(reviewed.contract),responsible_id:linkedProposal?.responsible_id||null,organization_id:oid,client_id:resolvedClientId,proposal_id:relatedProposalId||null,created_by:user?.id,updated_by:user?.id,setup_received_amount:0,setup_received_at:null,setup_payment_method:null})
      contract.status=contract.status||'draft'
      created.contract=unwrap(await client.from('contracts').insert(contract).select().single());contractId=created.contract.id
      stage='serviços';onProgress('Vinculando serviços')
      const services=(reviewed.services||[]).map((service)=>cleanRecord({...pick(extractedValues(service),serviceFields),organization_id:oid,contract_id:contractId})).filter((service)=>service.service_name)
      if(services.length){created.servicesTable='contract_services';unwrap(await client.from('contract_services').insert(services))}
    }
    stage='documento';onProgress('Salvando documento')
    const file=unwrap(await client.storage.from(analysis.temp_bucket).download(analysis.temp_path))
    created.finalPath=`${oid}/imports/${type}/${crypto.randomUUID()}-${safeName(analysis.file_name)}`
    unwrap(await client.storage.from(FINAL_DOCUMENT_BUCKET).upload(created.finalPath,file,{contentType:analysis.mime_type,upsert:false}))
    const documentObservation=type==='other'?valueOf(reviewed.contract?.notes):null
    created.document=unwrap(await client.from('documents').insert({organization_id:oid,client_id:resolvedClientId,proposal_id:proposalId,contract_id:contractId,document_type:type,file_name:analysis.file_name,storage_bucket:FINAL_DOCUMENT_BUCKET,storage_path:created.finalPath,mime_type:analysis.mime_type,file_size:analysis.file_size,uploaded_by:user?.id,notes:`Importado após revisão humana. Confiança geral: ${Math.round(Number(result.confidence||0)*100)}%.${documentObservation?` Observações: ${String(documentObservation).slice(0,500)}`:''}`}).select().single())
    stage='histórico';onProgress('Registrando histórico')
    unwrap(await client.from('commercial_events').insert({organization_id:oid,client_id:resolvedClientId,proposal_id:proposalId,contract_id:contractId,event_type:'document_import_confirmed',title:'Importação de documento confirmada',description:analysis.file_name,new_value:{analysis_id:analysis.id,document_id:created.document.id,document_type:result.documentType,field_count:result.fieldCount||0,low_confidence_fields:result.lowConfidenceFields?.length||0,action:entityAction},created_by:user?.id}))
    const analysisUpdate=await client.from('document_analyses').update({status:'confirmed',document_type:type,confirmed_document_id:created.document.id,expires_at:new Date().toISOString()}).eq('id',analysis.id)
    await client.storage.from(analysis.temp_bucket).remove([analysis.temp_path])
    onProgress(analysisUpdate.error?'Importação parcialmente concluída':'Importação concluída')
    return {clientId:resolvedClientId,proposalId,contractId,documentId:created.document.id,partial:Boolean(analysisUpdate.error)}
  }catch(error){
    let compensationFailed=false
    const compensate=async(operation)=>{try{const response=await operation();if(response?.error)compensationFailed=true}catch{compensationFailed=true}}
    if(created.document)await compensate(()=>client.from('documents').delete().eq('id',created.document.id))
    if(created.servicesTable){const parentKey=created.proposal?'proposal_id':'contract_id',parentId=created.proposal?.id||created.contract?.id;await compensate(()=>client.from(created.servicesTable).delete().eq(parentKey,parentId))}
    if(created.proposal)await compensate(()=>client.from('proposals').delete().eq('id',created.proposal.id))
    if(created.contract)await compensate(()=>client.from('contracts').delete().eq('id',created.contract.id))
    if(created.client)await compensate(()=>client.from('clients').delete().eq('id',created.client.id))
    if(created.finalPath)await compensate(()=>client.storage.from(FINAL_DOCUMENT_BUCKET).remove([created.finalPath]))
    const noun=type==='proposal'?'a proposta':type==='other'?'o documento':'o contrato',message=compensationFailed?`${noun[0].toUpperCase()+noun.slice(1)} foi parcialmente importado na etapa de ${stage}. Você pode tentar novamente sem criar outro registro.`:`Não foi possível importar ${noun}. Nenhum registro parcial foi mantido.`
    const safeError=new Error(message,{cause:error});safeError.stage=stage;safeError.partial=compensationFailed;safeError.code=import.meta.env.DEV?error?.code||'IMPORT_FAILED':undefined
    throw safeError
  }
}
