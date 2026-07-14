const DAY=86400000
const norm=(value)=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
const amount=(value)=>Number(value||0)
const label=(contract,clients=[])=>contract.clients?.company_name||contract.client_name||clients.find((client)=>client.id===contract.client_id)?.company_name||contract.contract_number||'Cliente não identificado'
const date=(value)=>{if(!value)return null;const parsed=new Date(`${String(value).slice(0,10)}T12:00:00`);return Number.isNaN(parsed.getTime())?null:parsed}
const openProposal=(proposal)=>!['won','lost','cancelled','expired','fechada','perdida'].includes(norm(proposal.status||proposal.proposal_status))
const activeContract=(contract)=>norm(contract.status||contract.proposal_status)==='active'&&(contract.signed??contract.contract_signed??true)
const serviceRows=(contract)=>contract.contract_services||contract.services||[]
const responsibleName=(service,kind)=>service?.[`${kind}Responsible`]?.name||service?.[`${kind}_responsible`]?.name||service?.team_members?.name||''

export function buildCausalAnalysis(data={},now=new Date()){
  const contracts=data.contracts||[],installments=data.installments||[],proposals=data.proposals||[],clients=data.clients||[]
  const active=contracts.filter(activeContract),findings=[]
  const currentMrr=active.reduce((sum,contract)=>sum+amount(contract.monthly_value),0)
  const nextMonthEnd=new Date(now.getFullYear(),now.getMonth()+2,0,23,59,59)
  const expiring=active.filter((contract)=>{const end=date(contract.end_date);return end&&end>now&&end<=nextMonthEnd&&!contract.auto_renew})
  const expiringMrr=expiring.reduce((sum,contract)=>sum+amount(contract.monthly_value),0)
  if(expiring.length&&currentMrr>0)findings.push({id:'revenue-drop',type:'Receita',severity:'Alta',statement:`O faturamento previsto pode cair ${(expiringMrr/currentMrr*100).toFixed(1)}% porque ${expiring.length} contrato(s) vencem até o fim do próximo mês.`,evidence:expiring.map((contract)=>`${label(contract,clients)} (${amount(contract.monthly_value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})})`),metric:expiringMrr,sources:['Contratos','Dashboard']})

  const byService=new Map()
  active.forEach((contract)=>{const services=serviceRows(contract);if(!services.length)return;const explicit=services.reduce((sum,service)=>sum+amount(service.monthly_value??service.monthlyValue),0);services.forEach((service)=>{const name=service.service_name||service.serviceName||'Serviço não informado';const contribution=explicit>0?amount(service.monthly_value??service.monthlyValue):amount(contract.monthly_value)/services.length;byService.set(name,(byService.get(name)||0)+contribution)})})
  const leading=[...byService].sort((a,b)=>b[1]-a[1])[0]
  if(leading&&currentMrr>0)findings.push({id:'service-share',type:'Serviços',severity:'Informativa',statement:`${leading[0]} representa ${(leading[1]/currentMrr*100).toFixed(1)}% da receita recorrente ativa.`,evidence:[`${leading[0]}: ${leading[1].toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}`,`MRR total: ${currentMrr.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}`],metric:leading[1],sources:['Contratos','Serviços','Dashboard']})

  const workload=new Map()
  active.flatMap(serviceRows).filter((service)=>!['completed','cancelled','paused'].includes(norm(service.service_status||service.status))).forEach((service)=>{const name=responsibleName(service,'delivery')||'Sem responsável';workload.set(name,(workload.get(name)||0)+1)})
  ;[...workload].sort((a,b)=>b[1]-a[1]).forEach(([name,count])=>findings.push({id:`workload-${norm(name)}`,type:'Equipe',severity:name==='Sem responsável'?'Média':'Informativa',statement:`${name} está responsável por ${count} entrega(s) ativa(s).`,evidence:[`${count} serviço(s) contratado(s) em execução`],metric:count,sources:['Equipe','Serviços','Contratos']}))

  const billedContracts=new Set(installments.map((item)=>item.contract_id))
  const withoutBilling=active.filter((contract)=>!billedContracts.has(contract.id))
  if(withoutBilling.length)findings.push({id:'clients-without-billing',type:'Financeiro',severity:'Alta',statement:`Existem ${new Set(withoutBilling.map((contract)=>contract.client_id)).size} cliente(s) com contrato ativo sem cobrança gerada.`,evidence:withoutBilling.map((contract)=>label(contract,clients)),metric:withoutBilling.length,sources:['Clientes','Contratos','Financeiro']})

  const overdueByClient=new Map()
  installments.filter((item)=>amount(item.amount)>amount(item.received_amount)&&date(item.due_date)<now&&!['cancelled','refunded'].includes(norm(item.status))).forEach((item)=>{const days=Math.floor((now-date(item.due_date))/DAY),current=overdueByClient.get(item.client_id);if(!current||days>current.days)overdueByClient.set(item.client_id,{item,days})})
  ;[...overdueByClient.values()].sort((a,b)=>b.days-a.days).slice(0,8).forEach(({item,days})=>{const client=clients.find((row)=>row.id===item.client_id);findings.push({id:`overdue-${item.client_id}`,type:'Inadimplência',severity:days>=30?'Alta':'Média',statement:`${client?.company_name||item.clients?.company_name||'Cliente não identificado'} está inadimplente há ${days} dia(s).`,evidence:[`Vencimento: ${String(item.due_date).slice(0,10)}`,`Saldo: ${Math.max(amount(item.amount)-amount(item.received_amount),0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}`],metric:days,sources:['Clientes','Financeiro']})})

  active.filter((contract)=>amount(contract.setup_value)>0&&amount(contract.setup_received_amount)===0&&!installments.some((item)=>item.contract_id===contract.id&&item.installment_type==='setup'&&amount(item.received_amount)>0)).forEach((contract)=>findings.push({id:`setup-${contract.id}`,type:'Setup',severity:'Alta',statement:`O setup do contrato ${contract.contract_number||label(contract,clients)} nunca foi recebido.`,evidence:[`${label(contract,clients)} · ${amount(contract.setup_value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}`],metric:amount(contract.setup_value),sources:['Contratos','Financeiro']}))

  const automation=proposals.filter((proposal)=>norm(proposal.mainService||proposal.main_service||proposal.title||proposal.proposal_services?.map((service)=>service.service_name).join(' ')).includes('automacao'))
  const stalled=automation.filter((proposal)=>{const sent=date(proposal.sentAt||proposal.sent_at||proposal.proposal_sent_date||proposal.created_at);return openProposal(proposal)&&sent&&(now-sent)/DAY>20})
  if(stalled.length){const concluded=automation.filter((proposal)=>['won','lost','fechada','perdida'].includes(norm(proposal.status||proposal.proposal_status))),won=concluded.filter((proposal)=>['won','fechada'].includes(norm(proposal.status||proposal.proposal_status))).length;findings.push({id:'automation-conversion',type:'Conversão',severity:'Média',statement:`A conversão de Automação está sob pressão porque ${stalled.length} proposta(s) permanecem abertas há mais de 20 dias.`,evidence:[`Conversão concluída: ${concluded.length?(won/concluded.length*100).toFixed(1):'0.0'}%`,...stalled.slice(0,5).map((proposal)=>proposal.title||proposal.companyName||'Proposta sem título')],metric:stalled.length,sources:['Propostas','Dashboard']})}
  return findings
}
