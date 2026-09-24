export const OPERATION_TIME_ZONE='America/Sao_Paulo'
export const isoInSaoPaulo=(value=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:OPERATION_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(value)
export const addIsoDays=(iso,amount)=>{const date=new Date(`${iso}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+amount);return date.toISOString().slice(0,10)}
export const startOfWeek=(iso=isoInSaoPaulo())=>{const weekday=new Date(`${iso}T12:00:00Z`).getUTCDay();return addIsoDays(iso,-((weekday+6)%7))}
export const weekDays=(iso=isoInSaoPaulo())=>Array.from({length:7},(_,index)=>addIsoDays(startOfWeek(iso),index))
export const monthBounds=(iso=isoInSaoPaulo())=>{const [year,month]=iso.split('-').map(Number);const start=`${year}-${String(month).padStart(2,'0')}-01`;const end=new Date(Date.UTC(year,month,0,12)).toISOString().slice(0,10);return{start,end}}
export const monthGrid=(iso=isoInSaoPaulo())=>{const {start,end}=monthBounds(iso),first=startOfWeek(start),lastWeek=startOfWeek(end),last=addIsoDays(lastWeek,6);const days=[];for(let day=first;day<=last;day=addIsoDays(day,1))days.push(day);return days}
export const isOpenTask=(task)=>!['completed','cancelled'].includes(task.status)&&!task.archived_at
export const taskOperationalDate=(task)=>task.due_date||String(task.starts_at||task.created_at||'').slice(0,10)||null
export const isHistoricalTask=(task,operationalStartDate)=>Boolean(operationalStartDate&&taskOperationalDate(task)&&taskOperationalDate(task)<operationalStartDate)
export const projectTasks=(tasks,{view='today',anchor=isoInSaoPaulo(),operationalStartDate=null}={})=>{
  const current=tasks.filter((task)=>!isHistoricalTask(task,operationalStartDate))
  if(view==='backlog')return current.filter((task)=>!task.due_date&&!task.archived_at&&task.status!=='cancelled')
  if(view==='history')return tasks.filter((task)=>isHistoricalTask(task,operationalStartDate)||task.status==='completed'||task.archived_at)
  if(view==='today')return current.filter((task)=>task.due_date===anchor||Boolean(task.due_date&&task.due_date<anchor&&isOpenTask(task)))
  if(view==='week'){const days=weekDays(anchor);return current.filter((task)=>task.due_date>=days[0]&&task.due_date<=days[6]&&!task.archived_at)}
  if(view==='month'){const {start,end}=monthBounds(anchor);return current.filter((task)=>task.due_date>=start&&task.due_date<=end&&!task.archived_at)}
  return current.filter((task)=>!task.archived_at)
}
export const operationMetrics=(tasks,anchor=isoInSaoPaulo())=>({
  total:tasks.length,
  pending:tasks.filter(isOpenTask).length,
  completed:tasks.filter((task)=>task.status==='completed').length,
  overdue:tasks.filter((task)=>task.due_date&&task.due_date<anchor&&isOpenTask(task)).length,
})
export const groupByDate=(items)=>items.reduce((groups,item)=>{const key=item.due_date||'backlog';(groups[key]??=[]).push(item);return groups},{})
export const summarizeOperationHours=(tasks,target=35)=>{const planned=tasks.reduce((sum,item)=>sum+Number(item.planned_hours||0),0),worked=tasks.reduce((sum,item)=>sum+Number(item.worked_hours||0),0);return{target:Number(target)||0,planned,worked,remaining:Math.max((Number(target)||0)-worked,0),balance:worked-planned}}
const personalCategories=new Set(['Laura','Família','Júlia + Kleber','Treino','Estudo','Casa','Alimentação','Tempo livre'])
export const taskCategoryScope=(task)=>task.invoice_installment_id||task.category==='Financeiro'?'financial':task.client_id?'clients':personalCategories.has(task.category)?'personal':'work'
