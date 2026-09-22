export const OPERATION_TIME_ZONE='America/Sao_Paulo'
export const isoInSaoPaulo=(value=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:OPERATION_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(value)
export const addIsoDays=(iso,amount)=>{const date=new Date(`${iso}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+amount);return date.toISOString().slice(0,10)}
export const startOfWeek=(iso=isoInSaoPaulo())=>{const weekday=new Date(`${iso}T12:00:00Z`).getUTCDay();return addIsoDays(iso,-((weekday+6)%7))}
export const weekDays=(iso=isoInSaoPaulo())=>Array.from({length:7},(_,index)=>addIsoDays(startOfWeek(iso),index))
export const monthBounds=(iso=isoInSaoPaulo())=>{const [year,month]=iso.split('-').map(Number);const start=`${year}-${String(month).padStart(2,'0')}-01`;const end=new Date(Date.UTC(year,month,0,12)).toISOString().slice(0,10);return{start,end}}
export const monthGrid=(iso=isoInSaoPaulo())=>{const {start,end}=monthBounds(iso),first=startOfWeek(start),lastWeek=startOfWeek(end),last=addIsoDays(lastWeek,6);const days=[];for(let day=first;day<=last;day=addIsoDays(day,1))days.push(day);return days}
export const isOpenTask=(task)=>!['completed','cancelled'].includes(task.status)&&!task.archived_at
export const projectTasks=(tasks,{view='today',anchor=isoInSaoPaulo()}={})=>{
  if(view==='backlog')return tasks.filter((task)=>!task.due_date&&!task.archived_at&&task.status!=='cancelled')
  if(view==='history')return tasks.filter((task)=>task.status==='completed'||task.archived_at)
  if(view==='today')return tasks.filter((task)=>task.due_date===anchor||Boolean(task.due_date&&task.due_date<anchor&&isOpenTask(task)))
  if(view==='week'){const days=weekDays(anchor);return tasks.filter((task)=>task.due_date>=days[0]&&task.due_date<=days[6]&&!task.archived_at)}
  if(view==='month'){const {start,end}=monthBounds(anchor);return tasks.filter((task)=>task.due_date>=start&&task.due_date<=end&&!task.archived_at)}
  return tasks.filter((task)=>!task.archived_at)
}
export const operationMetrics=(tasks,anchor=isoInSaoPaulo())=>({
  total:tasks.length,
  pending:tasks.filter(isOpenTask).length,
  completed:tasks.filter((task)=>task.status==='completed').length,
  overdue:tasks.filter((task)=>task.due_date&&task.due_date<anchor&&isOpenTask(task)).length,
})
export const groupByDate=(items)=>items.reduce((groups,item)=>{const key=item.due_date||'backlog';(groups[key]??=[]).push(item);return groups},{})
