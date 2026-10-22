import assert from 'node:assert/strict'
import test from 'node:test'
import { buildKnowledgePrompt, composeHandoffResponse, followupDue, pendingInboundText, stripUnauthorizedLinks } from '../supabase/functions/_shared/attendanceCore.js'
import { generateStructured, resolveAiProvider } from '../supabase/functions/_shared/aiProvider.js'

test('mensagens seguidas do lead viram uma entrada só', () => {
  const messages = [
    { direction: 'in', text_content: 'oi' },
    { direction: 'out', text_content: 'Oi! Tudo bem?' },
    { direction: 'in', text_content: 'tudo' },
    { direction: 'in', text_content: 'queria saber de tráfego pago' },
    { direction: 'in', text_content: '' },
  ]
  assert.equal(pendingInboundText(messages), 'tudo\nqueria saber de tráfego pago')
  assert.equal(pendingInboundText([{ direction: 'out', text_content: 'x' }]), '')
})

test('base de conhecimento entra organizada e com regras de repasse', () => {
  const prompt = buildKnowledgePrompt([
    { category: 'servicos', title: 'Tráfego pago', content: 'Meta Ads e Google Ads.' },
    { category: 'regras', title: 'Prazo', content: 'Nunca prometer resultado em dias.' },
    { category: 'cases', title: 'Inativo', content: 'não aparece', active: false },
  ], { meeting_link: 'https://cal.com/mugo/30min', voice_tone: 'Leve e direto.' }, { ownerFirstName: 'Kleber', operationalOpen: false })
  assert.match(prompt, /## Serviços[\s\S]*Tráfego pago/)
  assert.match(prompt, /## Regras — o que NÃO dizer/)
  assert.doesNotMatch(prompt, /não aparece/)
  assert.match(prompt, /https:\/\/cal\.com\/mugo\/30min/)
  assert.match(prompt, /Kleber/)
  assert.match(prompt, /FORA do horário/)
  assert.match(buildKnowledgePrompt([], {}), /Base ainda vazia/)
})

test('repasse mantém o texto da IA e só completa o que falta', () => {
  const natural = 'Entendi: site novo para a loja com integração ao Bling. O Kleber continua com você por aqui.'
  assert.equal(composeHandoffResponse({ modelResponse: natural, ownerFirstName: 'Kleber' }), natural)
  assert.equal(
    composeHandoffResponse({ modelResponse: 'Perfeito, anotei tudo!', ownerFirstName: 'Kleber' }),
    'Perfeito, anotei tudo. Kleber, do nosso time, continua com você por aqui.',
  )
  const off = composeHandoffResponse({ modelResponse: '', ownerFirstName: null, operationalOpen: false })
  assert.match(off, /Alguém do nosso time continua/)
  assert.match(off, /próximo período útil/)
})

test('links fora da base são removidos', () => {
  const text = 'Agende aqui https://cal.com/mugo/30min. Veja também https://site-inventado.com e nosso case https://mugo.com.br/cases.'
  const result = stripUnauthorizedLinks(text, { meetingLink: 'https://cal.com/mugo/30min', knowledge: [{ content: 'Case: https://mugo.com.br/cases' }] })
  assert.match(result, /cal\.com\/mugo\/30min/)
  assert.match(result, /mugo\.com\.br\/cases/)
  assert.doesNotMatch(result, /site-inventado/)
})

test('retomada só dentro da janela de 24h, uma vez, com IA automática', () => {
  const now = Date.parse('2026-10-22T15:00:00Z')
  const base = { attendance_mode: 'bot', automation_paused: false, last_inbound_at: '2026-10-22T09:00:00Z', last_outbound_at: '2026-10-22T09:01:00Z' }
  const settings = { ai_mode: 'controlled_auto', followup_enabled: true, followup_after_minutes: 240 }
  assert.equal(followupDue(base, settings, now), true)
  assert.equal(followupDue(base, { ...settings, ai_mode: 'copilot' }, now), false)
  assert.equal(followupDue({ ...base, last_inbound_at: '2026-10-22T09:02:00Z' }, settings, now), false) // lead respondeu por último
  assert.equal(followupDue(base, { ...settings, followup_after_minutes: 600 }, now), false) // ainda cedo
  assert.equal(followupDue({ ...base, last_inbound_at: '2026-10-21T14:00:00Z', last_outbound_at: '2026-10-21T14:01:00Z' }, settings, now), false) // janela fechada
  assert.equal(followupDue({ ...base, attendance_mode: 'human' }, settings, now), false)
})

test('provedor de IA: Claude por padrão, OpenAI quando pedido ou única chave', () => {
  assert.equal(resolveAiProvider({ provider: '', anthropicKey: 'a', openaiKey: 'o' }).provider, 'anthropic')
  assert.equal(resolveAiProvider({ provider: '', anthropicKey: '', openaiKey: 'o', model: 'gpt-x' }).provider, 'openai')
  assert.equal(resolveAiProvider({ provider: 'openai', anthropicKey: 'a', openaiKey: 'o' }).provider, 'openai')
  assert.equal(resolveAiProvider({ provider: '', anthropicKey: 'a' }).model, 'claude-sonnet-5-5')
})

test('Claude devolve a saída da ferramenta forçada', async () => {
  let request
  const fetchImpl = async (url, init) => { request = { url, body: JSON.parse(init.body), headers: init.headers }; return new Response(JSON.stringify({ model: 'claude-sonnet-5-5', content: [{ type: 'tool_use', name: 'decision', input: { response: 'Oi!' } }] }), { status: 200 }) }
  const result = await generateStructured({ provider: 'anthropic', anthropicKey: 'k', system: 's', user: 'u', schema: { type: 'object', properties: { response: { type: 'string' } } }, schemaName: 'decision', fetchImpl })
  assert.equal(result.data.response, 'Oi!')
  assert.equal(request.url, 'https://api.anthropic.com/v1/messages')
  assert.deepEqual(request.body.tool_choice, { type: 'tool', name: 'decision' })
  assert.equal(request.headers['anthropic-version'], '2023-06-01')
  const failing = async () => new Response('{}', { status: 529 })
  await assert.rejects(generateStructured({ provider: 'anthropic', anthropicKey: 'k', system: 's', user: 'u', schema: {}, fetchImpl: failing }), { code: 'AI_TEMPORARY_ERROR' })
  await assert.rejects(generateStructured({ provider: 'anthropic', anthropicKey: '', system: 's', user: 'u', schema: {} }), { code: 'AI_NOT_CONFIGURED' })
})

test('GPT: schema estrito sem palavras-chave recusadas, busca na web com recuo', async () => {
  const { openAiStrictSchema } = await import('../supabase/functions/_shared/aiProvider.js')
  const { PROSPECT_RESEARCH_SCHEMA } = await import('../supabase/functions/_shared/prospectingCore.js')
  const cleaned = JSON.stringify(openAiStrictSchema(PROSPECT_RESEARCH_SCHEMA))
  assert.doesNotMatch(cleaned, /"(minimum|maximum|maxItems|minItems)"/)
  assert.equal(JSON.parse(cleaned).required.length, Object.keys(JSON.parse(cleaned).properties).length)
  const bodies = []
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body); bodies.push(body)
    if (body.tools) return new Response('{}', { status: 400 })
    return new Response(JSON.stringify({ output_text: JSON.stringify({ ok: true }) }), { status: 200 })
  }
  const result = await generateStructured({ provider: 'openai', openaiKey: 'k', model: 'gpt-x', system: 's', user: 'u', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false }, webSearch: true, fetchImpl })
  assert.deepEqual(result.data, { ok: true })
  assert.equal(result.provider, 'openai')
  assert.deepEqual(bodies[0].tools, [{ type: 'web_search' }])
  assert.equal(bodies[1].tools, undefined)
})

test('botão de triagem: wa.me com assunto, limites da Meta e link inválido ignorado', async () => {
  const { buildTriageCta, interactiveCtaBody } = await import('../supabase/functions/_shared/attendanceCore.js')
  const cta = buildTriageCta({ triage_cta_url: 'https://wa.me/5511999999999', triage_cta_label: 'Falar com a equipe Mugô agora' }, { summary: 'site + tráfego', contactName: 'Ana' })
  assert.equal(cta.label.length <= 20, true)
  assert.match(cta.url, /^https:\/\/wa\.me\/5511999999999\?text=/)
  assert.match(decodeURIComponent(cta.url), /Ana.*Assunto: site \+ tráfego/)
  assert.equal(buildTriageCta({ triage_cta_url: 'https://chat.whatsapp.com/abc' }).url, 'https://chat.whatsapp.com/abc')
  assert.equal(buildTriageCta({ triage_cta_url: 'http://inseguro.com' }), null)
  assert.equal(buildTriageCta({}), null)
  const body = interactiveCtaBody('Perfeito!', cta)
  assert.equal(body.type, 'cta_url')
  assert.equal(body.action.parameters.display_text, cta.label)
})
