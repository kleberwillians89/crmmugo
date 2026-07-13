export function userError(error, fallback='Não foi possível concluir a operação.') {
  const message=String(error?.message||'').toLowerCase()
  if(!navigator.onLine)return 'Você está offline. Verifique sua conexão.'
  if(message.includes('jwt')||message.includes('session'))return 'Sua sessão expirou. Entre novamente.'
  if(message.includes('row-level')||message.includes('permission')||message.includes('42501'))return 'Você não tem permissão para esta operação.'
  if(message.includes('duplicate')||message.includes('23505'))return 'Já existe um registro com estes dados.'
  if(message.includes('relation')||message.includes('schema cache'))return 'A atualização da base de dados ainda não foi aplicada.'
  if(message.includes('not found')||message.includes('pgrst116'))return 'Registro não encontrado.'
  return fallback
}
