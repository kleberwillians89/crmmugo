import { createClient } from '@supabase/supabase-js'

export const dataProvider = import.meta.env.VITE_DATA_PROVIDER || 'legacy'
let instance
export function getSupabaseClient() {
  if (dataProvider !== 'supabase') return null
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) throw new Error('Supabase não configurado. Verifique as variáveis públicas do ambiente.')
  if (!instance) instance = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } })
  return instance
}
