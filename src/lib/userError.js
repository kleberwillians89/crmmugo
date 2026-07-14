import { ERROR_MESSAGES } from '../config/errorMessages.js'
export function userError(error, fallback=ERROR_MESSAGES.generic) {
  const message=String(error?.message||'').toLowerCase()
  if(typeof navigator!=='undefined'&&!navigator.onLine)return ERROR_MESSAGES.offline
  if(message.includes('jwt')||message.includes('session'))return ERROR_MESSAGES.session
  if(message.includes('row-level')||message.includes('permission')||message.includes('42501'))return ERROR_MESSAGES.permission
  if(message.includes('duplicate')||message.includes('23505'))return ERROR_MESSAGES.duplicate
  if(message.includes('relation')||message.includes('schema cache'))return ERROR_MESSAGES.migration
  if(message.includes('not found')||message.includes('pgrst116'))return ERROR_MESSAGES.notFound
  return fallback
}
export function errorPresentation(error,fallback=ERROR_MESSAGES.generic,context={}){
  const friendly=userError(error,fallback),status=error?.status||error?.statusCode||error?.cause?.status||null
  const message=error?.message||error?.cause?.message||null,details=error?.details||error?.cause?.details||null
  const constraint=error?.constraint||error?.cause?.constraint||`${message||''} ${details||''}`.match(/constraint\s+"?([^"\s]+)/i)?.[1]?.replace(/["'.]/g,'')||null
  const recordId=context.recordId||context.id||error?.recordId||error?.cause?.recordId||null
  return{friendly,technical:{code:error?.code||error?.cause?.code||null,message,details,hint:error?.hint||error?.cause?.hint||null,status,constraint,operation:context.operation||error?.operation||null,entity:context.entity||null,recordId,id:recordId}}
}
