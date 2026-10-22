// Camada única de IA para os workers. Claude (Anthropic) é o padrão quando
// ANTHROPIC_API_KEY existe; OpenAI continua disponível (AI_PROVIDER=openai).
// Sempre devolve JSON validado pelo schema pedido, ou lança erro com `code`.

const env = (name) => (typeof Deno !== 'undefined' ? Deno.env.get(name) : process.env[name]) || ''

export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5'

export function resolveAiProvider(overrides = {}) {
  const explicit = (overrides.provider || env('AI_PROVIDER')).toLowerCase()
  const anthropicKey = overrides.anthropicKey ?? env('ANTHROPIC_API_KEY')
  const openaiKey = overrides.openaiKey ?? env('OPENAI_API_KEY')
  const provider = explicit === 'openai' || (!explicit && !anthropicKey && openaiKey) ? 'openai' : 'anthropic'
  if (provider === 'anthropic') {
    return { provider, key: anthropicKey, model: overrides.model || env('ANTHROPIC_MODEL') || DEFAULT_ANTHROPIC_MODEL }
  }
  return { provider, key: openaiKey, model: overrides.model || env('COMMERCIAL_AI_MODEL') || env('OPENAI_MODEL') }
}

const fail = (message, code) => Object.assign(new Error(message), { code })
const temporary = (status) => status === 429 || status >= 500

// Anthropic: força a chamada de uma ferramenta cujo input_schema é o schema
// pedido — a saída já chega como objeto estruturado.
async function callAnthropic({ key, model, system, user, schema, schemaName, maxTokens, fetchImpl, timeoutMs }) {
  const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
      tools: [{ name: schemaName, description: 'Registra a decisão estruturada. Sempre chame esta ferramenta.', input_schema: schema }],
      tool_choice: { type: 'tool', name: schemaName },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw fail(`Anthropic respondeu ${response.status}.`, temporary(response.status) ? 'AI_TEMPORARY_ERROR' : 'AI_REQUEST_FAILED')
  const body = await response.json()
  const block = (body?.content || []).find((item) => item?.type === 'tool_use' && item?.name === schemaName)
  if (!block?.input || typeof block.input !== 'object') throw fail('Resposta da IA sem estrutura.', 'AI_INVALID_OUTPUT')
  return { data: block.input, usage: body.usage || null, model: body.model || model }
}

// O modo estrito da OpenAI recusa algumas palavras-chave de validação; removemos só para a OpenAI
// (a validação continua no nosso código depois da resposta).
const OPENAI_UNSUPPORTED = new Set(['minimum', 'maximum', 'minItems', 'maxItems', 'minLength', 'maxLength'])
export function openAiStrictSchema(node) {
  if (Array.isArray(node)) return node.map(openAiStrictSchema)
  if (!node || typeof node !== 'object') return node
  return Object.fromEntries(Object.entries(node).filter(([key]) => !OPENAI_UNSUPPORTED.has(key)).map(([key, value]) => [key, openAiStrictSchema(value)]))
}

async function callOpenAI({ key, model, system, user, schema, schemaName, fetchImpl, timeoutMs, webSearch = false }) {
  const request = (withSearch) => fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      input: [{ role: 'system', content: system }, { role: 'user', content: user }],
      text: { format: { type: 'json_schema', name: schemaName, strict: true, schema: openAiStrictSchema(schema) } },
      ...(withSearch ? { tools: [{ type: 'web_search' }] } : {}),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  let response = await request(webSearch)
  // modelo sem suporte a busca na web: tenta de novo sem a ferramenta
  if (webSearch && response.status === 400) response = await request(false)
  if (!response.ok) throw fail(`OpenAI respondeu ${response.status}.`, temporary(response.status) ? 'AI_TEMPORARY_ERROR' : 'AI_REQUEST_FAILED')
  const body = await response.json()
  const text = body?.output_text || (body?.output || []).flatMap((item) => item?.content || []).find((item) => item?.type === 'output_text')?.text
  try { return { data: JSON.parse(String(text || '').slice(0, 20000)), usage: body.usage || null, model } } catch { throw fail('Resposta da IA não é JSON.', 'AI_INVALID_OUTPUT') }
}

/**
 * @param {{system:string,user:string,schema:object,schemaName?:string,maxTokens?:number,timeoutMs?:number,provider?:string,model?:string,fetchImpl?:any,anthropicKey?:string,openaiKey?:string,webSearch?:boolean}} options
 */
export async function generateStructured(options) {
  const config = resolveAiProvider(options)
  if (!config.key || !config.model) throw fail('IA não configurada.', 'AI_NOT_CONFIGURED')
  const args = {
    ...config,
    system: options.system,
    user: options.user,
    schema: options.schema,
    schemaName: options.schemaName || 'structured_output',
    maxTokens: options.maxTokens || 1500,
    timeoutMs: options.timeoutMs || 25_000,
    fetchImpl: options.fetchImpl || fetch,
    webSearch: Boolean(options.webSearch),
  }
  const result = config.provider === 'anthropic' ? await callAnthropic(args) : await callOpenAI(args)
  return { ...result, provider: config.provider }
}

/**
 * Pesquisa com busca na web (só Anthropic): Claude pesquisa e termina chamando
 * a ferramenta de saída. Reenvia em `pause_turn` até 3 vezes.
 * @param {{system:string,user:string,schema:object,schemaName?:string,maxSearches?:number,maxTokens?:number,timeoutMs?:number,fetchImpl?:any,anthropicKey?:string,model?:string}} options
 */
export async function researchWithWebSearch({ system, user, schema, schemaName = 'save_research', maxSearches = 4, maxTokens = 3000, timeoutMs = 90_000, fetchImpl = fetch, anthropicKey, model }) {
  const key = anthropicKey ?? env('ANTHROPIC_API_KEY')
  if (!key) throw fail('ANTHROPIC_API_KEY ausente.', 'AI_NOT_CONFIGURED')
  const messages = [{ role: 'user', content: user }]
  const tools = [
    { type: 'web_search_20250305', name: 'web_search', max_uses: maxSearches },
    { name: schemaName, description: 'Salva o resultado final da pesquisa. Chame exatamente uma vez, ao terminar.', input_schema: schema },
  ]
  for (let round = 0; round < 4; round += 1) {
    const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: model || env('ANTHROPIC_MODEL') || DEFAULT_ANTHROPIC_MODEL, max_tokens: maxTokens, system, messages, tools }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) throw fail(`Anthropic respondeu ${response.status}.`, temporary(response.status) ? 'AI_TEMPORARY_ERROR' : 'AI_REQUEST_FAILED')
    const body = await response.json()
    const output = (body?.content || []).find((item) => item?.type === 'tool_use' && item?.name === schemaName)
    if (output?.input) return { data: output.input, usage: body.usage || null }
    messages.push({ role: 'assistant', content: body.content || [] })
    if (body.stop_reason !== 'pause_turn') messages.push({ role: 'user', content: `Agora chame ${schemaName} com o resultado final.` })
  }
  throw fail('A pesquisa não terminou com resultado.', 'AI_INVALID_OUTPUT')
}

// Transcrição de áudio (WhatsApp manda OGG/Opus). Usa OpenAI quando há chave;
// sem chave, devolve null e o atendimento segue pedindo para a pessoa escrever.
/** @param {{bytes:any,mimeType?:string,fetchImpl?:any,openaiKey?:string}} options */
export async function transcribeAudio({ bytes, mimeType = 'audio/ogg', fetchImpl = fetch, openaiKey }) {
  const key = openaiKey ?? env('OPENAI_API_KEY')
  if (!key || !bytes) return null
  const form = new FormData()
  form.append('model', env('TRANSCRIPTION_MODEL') || 'gpt-4o-mini-transcribe')
  form.append('language', 'pt')
  form.append('file', new Blob([bytes], { type: mimeType }), mimeType.includes('ogg') ? 'audio.ogg' : 'audio.mp3')
  const response = await fetchImpl('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(45_000) })
  if (!response.ok) return null
  const body = await response.json().catch(() => ({}))
  const text = String(body?.text || '').trim()
  return text || null
}
