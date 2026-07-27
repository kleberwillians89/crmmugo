export const SENDABLE_TEMPLATE_STATUSES = Object.freeze(['APPROVED'])

export function isTemplateAvailable(name,templates=[]){
  const item=templates.find(template=>template.name===name&&template.language==='pt_BR')
  return item?.is_active!==false&&SENDABLE_TEMPLATE_STATUSES.includes(item?.status)
}
