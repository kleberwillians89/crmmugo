import assert from 'node:assert/strict'
import fs from 'node:fs'

/**
 * Regressão: "Clientes → WhatsApp" (navegação SPA) caía no AppErrorBoundary,
 * mas um reload direto em /whatsapp funcionava.
 *
 * Causa: o efeito de realtime da WhatsAppPage assinava um canal com tópico FIXO
 * ('whatsapp-crm-singleton'). O supabase-js deduplica canais por tópico
 * (RealtimeClient.channel devolve a instância existente). Numa remontagem via
 * troca de página, o canal anterior ainda estava no registro (teardown de
 * removeChannel é assíncrono e não aguardado), então .subscribe() reentrava em
 * uma instância que já tinha feito join → "tried to join multiple times" — e
 * .on() numa instância ainda joined → "cannot add postgres_changes callbacks
 * after subscribe()". A exceção era lançada sincronicamente dentro do useEffect
 * e subia até o AppErrorBoundary. Reload funcionava porque um novo
 * RealtimeClient começa com o registro vazio.
 *
 * Correção: tópico único por montagem (`whatsapp-crm-${crypto.randomUUID()}`)
 * + varredura de canais órfãos com prefixo 'realtime:whatsapp-crm' na montagem.
 */

// --- contrato mínimo do supabase-js realtime (comportamento observável) --------
class FakeChannel {
  constructor(topic) {
    this.topic = `realtime:${topic}`
    this.state = 'closed'
    this.joinedOnce = false
    this.bindings = 0
  }
  on(type) {
    if (this.state === 'joined' || this.state === 'joining') {
      throw new Error(`cannot add \`${type}\` callbacks for ${this.topic} after \`subscribe()\`.`)
    }
    this.bindings += 1
    return this
  }
  subscribe(cb) {
    if (this.state === 'closed') {
      if (this.joinedOnce) {
        throw new Error("tried to join multiple times. 'join' can only be called a single time per channel instance")
      }
      this.joinedOnce = true
      this.state = 'joined'
      if (cb) cb('SUBSCRIBED')
    }
    return this
  }
}

class FakeRealtimeClient {
  constructor() { this.channels = [] }
  getChannels() { return this.channels }
  channel(topic) {
    const realtimeTopic = `realtime:${topic}`
    const existing = this.channels.find((c) => c.topic === realtimeTopic)
    if (existing) return existing // dedupe por tópico, igual ao supabase-js
    const chan = new FakeChannel(topic)
    this.channels.push(chan)
    return chan
  }
  // removeChannel é assíncrono no supabase-js (await channel.unsubscribe() + teardown)
  // e a WhatsAppPage não o aguarda no cleanup. Uma remontagem síncrona (navegação
  // SPA) acontece antes do teardown fazer efeito, então o canal anterior ainda
  // está no registro e ainda "joined".
  removeChannel(channel) {
    return new Promise((resolve) => {
      setTimeout(() => {
        this.channels = this.channels.filter((c) => c !== channel)
        channel.state = 'closed'
        resolve('ok')
      }, 0)
    })
  }
}

// --- padrão ANTIGO (com bug): tópico fixo -------------------------------------
const buggyRealtimeEffect = (supabase) => {
  const channel = supabase
    .channel('whatsapp-crm-singleton')
    .on('postgres_changes', {}, () => {})
    .on('postgres_changes', {}, () => {})
    .on('postgres_changes', {}, () => {})
    .on('postgres_changes', {}, () => {})
    .subscribe(() => {})
  return () => { supabase.removeChannel(channel) }
}

// --- padrão CORRIGIDO: tópico único por montagem + varredura de órfãos --------
const fixedRealtimeEffect = (supabase) => {
  for (const stale of [...supabase.getChannels()]) {
    if (typeof stale?.topic === 'string' && stale.topic.startsWith('realtime:whatsapp-crm')) {
      supabase.removeChannel(stale)
    }
  }
  const channel = supabase
    .channel(`whatsapp-crm-${globalThis.crypto.randomUUID()}`)
    .on('postgres_changes', {}, () => {})
    .on('postgres_changes', {}, () => {})
    .on('postgres_changes', {}, () => {})
    .on('postgres_changes', {}, () => {})
    .subscribe(() => {})
  return () => { supabase.removeChannel(channel) }
}

// mount → unmount (cleanup síncrono, teardown assíncrono ainda pendente) → mount
const mountUnmountRemount = (effect) => {
  const supabase = new FakeRealtimeClient()
  effect(supabase)()          // 1ª montagem + desmontagem imediata (skeleton do App)
  return effect(supabase)     // remontagem síncrona (navegação SPA de volta)
}

// 1. O padrão antigo reproduz o crash.
assert.throws(
  () => mountUnmountRemount(buggyRealtimeEffect),
  /tried to join multiple times|after `subscribe/,
  'tópico fixo deveria lançar ao remontar (regressão original)',
)

// 2. O padrão corrigido não lança em nenhuma sequência de montagem.
assert.doesNotThrow(
  () => mountUnmountRemount(fixedRealtimeEffect),
  'tópico único por montagem não pode lançar ao remontar',
)

// 3. Remontagens repetidas continuam seguras e, após o teardown assíncrono
//    concluir, não vazam canais realtime.
{
  const supabase = new FakeRealtimeClient()
  let cleanup = () => {}
  for (let i = 0; i < 10; i += 1) {
    cleanup()
    assert.doesNotThrow(() => { cleanup = fixedRealtimeEffect(supabase) }, `remontagem ${i} não pode lançar`)
  }
  cleanup()
  await new Promise((resolve) => setTimeout(resolve, 5)) // deixa o teardown assíncrono concluir
  assert.equal(supabase.getChannels().length, 0, 'não deve vazar canais realtime órfãos após o teardown')
}

// --- contrato de código: a WhatsAppPage precisa manter o padrão corrigido -----
const source = fs.readFileSync(new URL('../src/components/WhatsAppPage.jsx', import.meta.url), 'utf8')
const realtimeChannelCall = source.match(/supabase\.channel\(([^\n]+?)\)\s*\n\s*\.on\('postgres_changes'/)
assert.ok(realtimeChannelCall, 'não encontrei o supabase.channel(...) do efeito de realtime')
assert.doesNotMatch(
  realtimeChannelCall[1],
  /^['"`][^'"`$]*['"`]$/,
  'o canal de realtime não pode usar um tópico fixo/estático — use um id único por montagem',
)
assert.match(realtimeChannelCall[1], /crypto\.randomUUID\(\)/, 'o tópico do canal deve ser único por montagem')
assert.match(source, /for\(const stale of \[\.\.\.supabase\.getChannels\(\)\]\)/, 'faltou a varredura de canais realtime órfãos na montagem')
assert.match(source, /return\(\)=>\{[^}]*supabase\.removeChannel\(channel\)/, 'o cleanup do efeito precisa remover o canal criado')

console.log('whatsapp-realtime-channel-lifecycle: OK')
