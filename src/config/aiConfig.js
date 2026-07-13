const requestedProvider = String(import.meta.env.VITE_AI_PROVIDER || 'local').toLowerCase()

export const AI_PROVIDER = ['local', 'supabase'].includes(requestedProvider) ? requestedProvider : 'local'
export const AI_PROVIDER_LABEL = AI_PROVIDER === 'supabase' ? 'Supabase Edge Function' : 'Somente cálculos locais'
export const AI_TIMEOUT_MS = 18000
export const AI_MAX_QUESTION_LENGTH = 1500
export const AI_MAX_CONVERSATION_ITEMS = 6
export const canUseExternalAssistant = (dataProvider) => AI_PROVIDER === 'supabase' && dataProvider === 'supabase'
