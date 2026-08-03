const number=(value)=>Number.isFinite(Number(value))?Number(value):0
export const normalizeFinancialName=(value)=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').trim()

export function findFinancialImportMatch(row,existing=[]){
  return existing.find((item)=>item.import_key===row.key)||existing.find((item)=>normalizeFinancialName(item.name)===normalizeFinancialName(row.name))||null
}

export function validateFinancialImportRow(row,{categoryExists=true}={}){
  const errors=[]
  if(!row?.key)errors.push('Chave de importação ausente')
  if(!String(row?.name||'').trim())errors.push('Descrição ausente')
  if(number(row?.amount)<=0)errors.push('Valor deve ser maior que zero')
  if(!row?.start_date)errors.push('Data inicial ausente')
  if(!Number.isInteger(Number(row?.due_day))||number(row.due_day)<1||number(row.due_day)>31)errors.push('Vencimento inválido')
  if(!['business','personal','shared','pending_review'].includes(row?.scope))errors.push('Escopo inválido')
  if(row?.scope==='shared'&&(number(row.business_percentage)<=0||number(row.business_percentage)>100))errors.push('Percentual compartilhado inválido')
  if(!categoryExists)errors.push('Categoria não cadastrada')
  return{valid:errors.length===0,errors}
}
