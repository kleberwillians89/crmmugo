export const SENDABLE_TEMPLATE_STATUSES = Object.freeze(['ACTIVE','APPROVED'])

export function isTemplateAvailable(name,templates=[]){
  const item=templates.find(template=>template.name===name&&template.language==='pt_BR')
  return SENDABLE_TEMPLATE_STATUSES.includes(item?.status)
}
