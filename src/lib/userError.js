import { ERROR_MESSAGES } from '../config/errorMessages'
export function userError(error, fallback=ERROR_MESSAGES.generic) {
  const message=String(error?.message||'').toLowerCase()
  if(!navigator.onLine)return ERROR_MESSAGES.offline
  if(message.includes('jwt')||message.includes('session'))return ERROR_MESSAGES.session
  if(message.includes('row-level')||message.includes('permission')||message.includes('42501'))return ERROR_MESSAGES.permission
  if(message.includes('duplicate')||message.includes('23505'))return ERROR_MESSAGES.duplicate
  if(message.includes('relation')||message.includes('schema cache'))return ERROR_MESSAGES.migration
  if(message.includes('not found')||message.includes('pgrst116'))return ERROR_MESSAGES.notFound
  return fallback
}
