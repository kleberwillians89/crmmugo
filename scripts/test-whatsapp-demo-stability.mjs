import assert from 'node:assert/strict'
import fs from 'node:fs'
import { resolveSupabasePublicConfig, sanitizeSupabaseEnvironment } from '../src/lib/supabase/config.js'

assert.equal(sanitizeSupabaseEnvironment(' https://project.supabase.co\r\n'), 'https://project.supabase.co')
const config=resolveSupabasePublicConfig({
  VITE_SUPABASE_URL:' https://project.supabase.co\n',
  VITE_SUPABASE_PUBLISHABLE_KEY:' sb_publishable_public-key\r\n',
})
assert.equal(config.url,'https://project.supabase.co')
assert.equal(config.key,'sb_publishable_public-key')
assert.equal(config.whitespaceDetected,true)
assert.throws(()=>resolveSupabasePublicConfig({VITE_SUPABASE_URL:'http://invalid',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_key'}),/HTTPS/)
assert.throws(()=>resolveSupabasePublicConfig({VITE_SUPABASE_URL:'https://valid.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'\n'}),/chave pública/)

const client=fs.readFileSync(new URL('../src/lib/supabase/client.js',import.meta.url),'utf8')
const page=fs.readFileSync(new URL('../src/components/WhatsAppPage.jsx',import.meta.url),'utf8')
const templates=fs.readFileSync(new URL('../src/components/WhatsAppTemplatesPanel.jsx',import.meta.url),'utf8')
const edge=fs.readFileSync(new URL('../supabase/functions/mugozap-api/index.ts',import.meta.url),'utf8')
assert.equal((client.match(/createSupabaseClient\(/g)||[]).length,1)
assert.match(client,/resolveSupabasePublicConfig/)
assert.doesNotMatch(page,/setTimeout\(poll,(5000|15000)\)/)
assert.equal((page.match(/timer=setTimeout\(poll,30000\)/g)||[]).length,2)
assert.doesNotMatch(templates,/if\(active\)await refresh\(true\)/)
for(const token of ['health_check','get_conversation_messages','send_template','UPSTREAM_CIRCUIT_OPEN','duration_ms'])assert.ok(edge.includes(token),`Edge sem ${token}`)
assert.match(page,/Modo demonstração: nenhuma mensagem foi enviada/)
assert.match(templates,/sincronização automática e manual estão desativadas/)
console.log('WhatsApp demo stability tests: ok')
