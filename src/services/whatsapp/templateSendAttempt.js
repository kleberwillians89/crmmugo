export const AMBIGUOUS_TEMPLATE_SEND_CODES = new Set([
  'META_TIMEOUT',
  'MESSAGE_SEND_UNCONFIRMED',
  'MESSAGE_PERSISTENCE_UNCONFIRMED',
  'SEND_OUTCOME_UNKNOWN',
  'UPSTREAM_TIMEOUT',
])

const STORAGE_KEY = 'mugo.whatsapp.template-send-attempts.v1'
const memoryRegistry = new Map()

export const isAmbiguousTemplateSendOutcome = cause => AMBIGUOUS_TEMPLATE_SEND_CODES.has(cause?.code) || cause?.status === 504

const canonicalize = value => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]))
}

// Digest opaco de 128 bits. O registry nunca persiste telefone, texto ou componentes
// em claro; o JSON canônico existe apenas durante este cálculo em memória.
const opaqueDigest = value => {
  let h1 = 0x9e3779b9, h2 = 0x243f6a88, h3 = 0xb7e15162, h4 = 0xdeadbeef
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    h1 = Math.imul(h1 ^ code, 0x85ebca6b)
    h2 = Math.imul(h2 ^ code, 0xc2b2ae35)
    h3 = Math.imul(h3 ^ code, 0x27d4eb2f)
    h4 = Math.imul(h4 ^ code, 0x165667b1)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 0x85ebca6b) ^ h2
  h2 = Math.imul(h2 ^ (h2 >>> 13), 0xc2b2ae35) ^ h3
  h3 = Math.imul(h3 ^ (h3 >>> 16), 0x27d4eb2f) ^ h4
  h4 = Math.imul(h4 ^ (h4 >>> 13), 0x165667b1) ^ h1
  return [h1,h2,h3,h4].map(part => (part >>> 0).toString(16).padStart(8, '0')).join('')
}

export const templateSendFingerprint = ({ recipient, templateName, language, components }) => {
  const canonical = JSON.stringify(canonicalize([
    String(recipient || '').replace(/\D/g, ''),
    String(templateName || '').trim(),
    String(language || 'pt_BR').trim(),
    Array.isArray(components) ? components : [],
  ]))
  return `template-send-${opaqueDigest(canonical)}`
}

const sessionStore = () => {
  try {
    const storage = globalThis.sessionStorage
    if (!storage) return null
    const probe = `${STORAGE_KEY}.probe`
    storage.setItem(probe, '1')
    storage.removeItem(probe)
    return storage
  } catch {
    return null
  }
}

const readSessionRegistry = storage => {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

const validRecord = record => record && /^[A-Za-z0-9_-]{16,120}$/.test(String(record.idempotencyKey || '')) && ['active','ambiguous'].includes(record.state)

const readRecord = fingerprint => {
  const storage = sessionStore()
  if (storage) {
    const record = readSessionRegistry(storage)[fingerprint]
    if (validRecord(record)) return record
  }
  return memoryRegistry.get(fingerprint) || null
}

const writeRecord = (fingerprint, record) => {
  const storage = sessionStore()
  if (!storage) {
    memoryRegistry.set(fingerprint, record)
    return
  }
  try {
    const registry = readSessionRegistry(storage)
    registry[fingerprint] = record
    storage.setItem(STORAGE_KEY, JSON.stringify(registry))
    memoryRegistry.delete(fingerprint)
  } catch {
    memoryRegistry.set(fingerprint, record)
  }
}

const deleteRecord = fingerprint => {
  if (!fingerprint) return
  const storage = sessionStore()
  memoryRegistry.delete(fingerprint)
  if (!storage) return
  try {
    const registry = readSessionRegistry(storage)
    delete registry[fingerprint]
    if (Object.keys(registry).length) storage.setItem(STORAGE_KEY, JSON.stringify(registry))
    else storage.removeItem(STORAGE_KEY)
  } catch {/* fallback em memória já foi limpo */}
}

export const createTemplateSendAttempt = (generateKey = () => crypto.randomUUID()) => {
  let fingerprint = ''

  return {
    sync(nextFingerprint) {
      const changed = nextFingerprint !== fingerprint
      fingerprint = nextFingerprint
      return changed
    },
    begin(nextFingerprint) {
      fingerprint = nextFingerprint
      const previous = readRecord(fingerprint)
      if (previous) return previous.idempotencyKey
      const idempotencyKey = generateKey()
      writeRecord(fingerprint, { idempotencyKey, state: 'active', updatedAt: Date.now() })
      return idempotencyKey
    },
    markAmbiguous(nextFingerprint) {
      fingerprint = nextFingerprint
      const previous = readRecord(fingerprint)
      const idempotencyKey = previous?.idempotencyKey || generateKey()
      writeRecord(fingerprint, { idempotencyKey, state: 'ambiguous', updatedAt: Date.now() })
    },
    isAmbiguous(nextFingerprint) {
      return readRecord(nextFingerprint)?.state === 'ambiguous'
    },
    markSuccess() {
      deleteRecord(fingerprint)
    },
    reset() {
      // Desanexa apenas a instância da UI. A tentativa da sessão deve sobreviver ao
      // unmount/close/reopen até sucesso, reconciliação ou mudança da mensagem.
      fingerprint = ''
    },
  }
}
