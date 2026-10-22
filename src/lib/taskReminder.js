export function taskReminderLabel(task){
  if(!task.due_time||task.reminder_enabled===false||task.archived_at||['completed','cancelled'].includes(task.status))return null
  if(task.reminder_status==='sent')return 'Lembrete enviado'
  if(['blocked','failed'].includes(task.reminder_status))return 'Lembrete pendente'
  return '🔔 WhatsApp 1h antes'
}

export function attachTaskReminderStates(tasks,reminders){
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'})
  return tasks.map(task=>{
    const reminder=reminders.find(row=>{
      if(row.task_id!==task.id||row.team_member_id!==task.assigned_to||row.organization_id!==task.organization_id||row.status==='cancelled')return false
      const parts=Object.fromEntries(formatter.formatToParts(new Date(row.due_at)).map(part=>[part.type,part.value]))
      return `${parts.year}-${parts.month}-${parts.day}`===task.due_date&&`${parts.hour}:${parts.minute}`===task.due_time?.slice(0,5)
    })
    return {...task,reminder_status:reminder?.status||null}
  })
}
