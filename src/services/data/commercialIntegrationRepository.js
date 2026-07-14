import {invalidateCrmData} from '../../lib/dataInvalidation'
import {assertContractId as assertUuid} from './contractPayload'
import {db,isSupabaseProvider,legacyUnavailable,unwrap} from './provider'

const changed=()=>invalidateCrmData({resources:['proposals','contracts','installments','finance','dashboard','clients','intelligence']})
const normalizeSearch=(value='')=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()

export async function searchProposals(search=''){
  if(!isSupabaseProvider())return legacyUnavailable('Busca de propostas')
  const rows=unwrap(await db().from('proposals').select('id,client_id,proposal_number,title,status,setup_value,monthly_value,total_value,clients(id,company_name,trade_name,document_number),contracts(id,contract_number,status)').is('deleted_at',null).order('created_at',{ascending:false}).range(0,9999))
  const term=normalizeSearch(search)
  return rows.filter((row)=>!term||normalizeSearch([row.proposal_number,row.title,row.clients?.company_name,row.clients?.trade_name,row.clients?.document_number].filter(Boolean).join(' ')).includes(term))
}

export async function linkProposalToContract({proposalId,contractId}){assertUuid(proposalId);assertUuid(contractId);const result=unwrap(await db().rpc('link_proposal_to_contract',{proposal_id:proposalId,contract_id:contractId}));changed();return result}
export async function unlinkProposalFromContract({proposalId,contractId}){assertUuid(proposalId);assertUuid(contractId);const result=unwrap(await db().rpc('unlink_proposal_from_contract',{proposal_id:proposalId,contract_id:contractId}));changed();return result}
export async function createContractFromProposal(proposalId){assertUuid(proposalId);const result=unwrap(await db().rpc('create_contract_from_proposal',{target_proposal_id:proposalId}));changed();return result}
export async function getBillingPreview(contractId,includeHistoricalPeriods=false){assertUuid(contractId);return unwrap(await db().rpc('get_contract_billing_preview',{target_contract_id:contractId,include_historical_periods:includeHistoricalPeriods}))}
export async function activateContractAndGenerateInstallments(contractId,includeHistoricalPeriods=false){assertUuid(contractId);const result=unwrap(await db().rpc('activate_contract_and_generate_installments',{target_contract_id:contractId,include_historical_periods:includeHistoricalPeriods}));changed();return result}

export async function findOrMatchClient({cnpj=null,cpf=null,email=null,companyName=null,tradeName=null,phone=null}={}){
  if(!isSupabaseProvider())return legacyUnavailable('Correspondência de clientes')
  const matches=unwrap(await db().rpc('find_matching_clients',{cnpj,cpf,email,company_name:companyName,trade_name:tradeName,phone}))||[]
  const exact=matches.filter((item)=>String(item.match_type).startsWith('exact_'))
  return{match:exact.length===1?exact[0]:null,candidates:matches,requiresConfirmation:exact.length!==1&&matches.length>0}
}
