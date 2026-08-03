import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { resolveSupabasePublicConfig } from './config.js'

export const dataProvider = import.meta.env.VITE_DATA_PROVIDER || 'legacy'
const STATE_KEY=Symbol.for('mugo.supabase.bootstrap.v1')
const state=globalThis[STATE_KEY]||(globalThis[STATE_KEY]={client:null,config:null,logged:false})

export function getSupabasePublicConfig() {
  if (!state.config) state.config=resolveSupabasePublicConfig(import.meta.env)
  return state.config
}

function safeBootstrapLog(config, client) {
  if(state.logged)return
  const realtimeKey=String(client?.realtime?.apiKey??'')
  const keyUnchanged=realtimeKey===config.key
  const payload={
    event:'supabase_bootstrap',
    url_length:config.diagnostics.urlLength,
    key_length:config.diagnostics.keyLength,
    key_sha256:config.diagnostics.keySha256,
    key_last_8:config.diagnostics.keyLast8,
    key_last_character_ascii:config.diagnostics.keyLastCharacterCode,
    has_cr:config.diagnostics.raw.key.hasCR,
    has_lf:config.diagnostics.raw.key.hasLF,
    has_tab:config.diagnostics.raw.key.hasTAB,
    has_spaces:config.diagnostics.raw.key.hasSpaces,
    has_bom:config.diagnostics.raw.key.hasBOM,
    has_invisible_unicode:config.diagnostics.raw.key.hasInvisibleUnicode,
    whitespace_detected:config.whitespaceDetected,
    realtime_key_unchanged:keyUnchanged,
    singleton_scope:'globalThis',
  }
  console.info('[SupabaseBootstrap]',payload)
  state.logged=true
  if(!keyUnchanged)throw new Error('O Supabase JS alterou a chave pública durante a inicialização.')
}

export function getSupabaseClient() {
  if (dataProvider !== 'supabase') return null
  if(state.client)return state.client
  const config=getSupabasePublicConfig()
  console.info('[SupabaseBootstrap:before-createClient]',{
    url_length:config.diagnostics.urlLength,
    key_length:config.diagnostics.keyLength,
    key_sha256:config.diagnostics.keySha256,
    key_last_8:config.diagnostics.keyLast8,
    key_last_character_ascii:config.diagnostics.keyLastCharacterCode,
    has_cr:config.diagnostics.raw.key.hasCR,
    has_lf:config.diagnostics.raw.key.hasLF,
    has_tab:config.diagnostics.raw.key.hasTAB,
    has_spaces:config.diagnostics.raw.key.hasSpaces,
    whitespace_detected:config.whitespaceDetected,
  })
  state.client=createSupabaseClient(config.url,config.key,{
    auth:{persistSession:true,autoRefreshToken:true},
  })
  safeBootstrapLog(config,state.client)
  return state.client
}
