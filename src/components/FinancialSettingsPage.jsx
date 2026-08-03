import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { createFinancialLookup, listExpenseLookups } from '../services/data/expensesRepository'
import { PageHeader } from './PageHeader'
import { FeedbackMessage } from './FeedbackMessage'

const settings={
  'expense-categories':{title:'Categorias de despesas',table:'expense_categories',key:'categories',description:'Plano de classificação para relatórios e contabilidade.'},
  'cost-centers':{title:'Centros de custo',table:'cost_centers',key:'costCenters',description:'Dimensões gerenciais para atribuir despesas.'},
  'financial-accounts':{title:'Contas financeiras',table:'financial_accounts',key:'accounts',description:'Caixa, bancos, cartões e contas de pagamento.'},
}
export function FinancialSettingsPage({section}){const config=settings[section],{canWrite}=useAuth(),[data,setData]=useState({categories:[],costCenters:[],accounts:[]}),[name,setName]=useState(''),[error,setError]=useState('');const load=()=>listExpenseLookups().then(setData).catch(()=>setError('Aplique a migration V2 para liberar estes cadastros.'));useEffect(load,[]);async function submit(event){event.preventDefault();try{await createFinancialLookup(config.table,config.table==='financial_accounts'?{name,account_type:'checking'}:{name});setName('');await load()}catch(cause){setError(cause.message)}}return <div><PageHeader eyebrow="Administração" title={config.title} description={config.description}/>{error&&<FeedbackMessage type="info">{error}</FeedbackMessage>}{canWrite&&<form className="inline-create" onSubmit={submit}><label>Nome<input required value={name} onChange={event=>setName(event.target.value)}/></label><button className="button">Adicionar</button></form>}<section className="dashboard-panel settings-list">{data[config.key].map(item=><div key={item.id}><strong>{item.name}</strong><span>{item.institution||item.description||'Ativo'}</span></div>)}{!data[config.key].length&&<p>Nenhum cadastro disponível.</p>}</section></div>}
