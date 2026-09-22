export const taskSyncState=(task)=>({title:task.title,status:task.status,priority:task.priority,due_date:task.due_date||null,due_time:task.due_time||null,assigned_to:task.assigned_to||null,client_id:task.client_id||null,notes:task.notes||null})
export const planTaskProjection=({link,stateHash})=>link?.last_synced_hash===stateHash?'skip':link?.external_id?'update':'create'
export const syncTargetsForOrigin=(origin)=>['trello','notion'].filter((provider)=>provider!==origin)
