// Gmail API via conta de serviço do Google Workspace (delegação em todo o domínio).
// Usado SOMENTE para prospecção 1-a-1 a partir da caixa do domínio secundário.
// Secrets: GMAIL_SERVICE_ACCOUNT_JSON (JSON da conta de serviço), GMAIL_SENDER (ex.: kleber@dominio2.com.br).

const env = (name) => (typeof Deno !== 'undefined' ? Deno.env.get(name) : process.env[name]) || ''
const SCOPES = 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly'

const base64url = (input) => {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function pemToBytes(pem) {
  const body = String(pem).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const binary = atob(body)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

let cachedToken = null
/** @param {{serviceAccountJson?:string,sender?:string,fetchImpl?:any}} [options] */
export async function gmailAccessToken({ serviceAccountJson = env('GMAIL_SERVICE_ACCOUNT_JSON'), sender = env('GMAIL_SENDER'), fetchImpl = fetch } = {}) {
  if (cachedToken && cachedToken.sender === sender && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token
  if (!serviceAccountJson || !sender) throw Object.assign(new Error('Gmail de prospecção não configurado.'), { code: 'GMAIL_NOT_CONFIGURED' })
  const account = JSON.parse(serviceAccountJson)
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64url(JSON.stringify({ iss: account.client_email, sub: sender, scope: SCOPES, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }))
  const key = await crypto.subtle.importKey('pkcs8', pemToBytes(account.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`)))
  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${base64url(signature)}` }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || !body.access_token) throw Object.assign(new Error(`Google recusou o acesso: ${body.error_description || body.error || response.status}`), { code: 'GMAIL_AUTH_FAILED' })
  cachedToken = { token: body.access_token, sender, expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000 }
  return cachedToken.token
}

const encodeHeader = (value) => /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(value)))}?=`
const wrapBase64 = (text) => {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/.{1,76}/g, '$&\r\n').trim()
}

/**
 * Monta um e-mail multipart (texto + HTML) pronto para a Gmail API.
 * @param {{from:string,fromName?:string,to:string,subject:string,text:string,html?:string,inReplyTo?:string,references?:string}} message
 */
export function buildMimeMessage({ from, fromName, to, subject, text, html, inReplyTo, references }) {
  const boundary = `mugo-${crypto.randomUUID()}`
  const headers = [
    `From: ${fromName ? `${encodeHeader(fromName)} <${from}>` : from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ]
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`)
  if (references) headers.push(`References: ${references}`)
  const parts = [
    `--${boundary}`, 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', wrapBase64(text),
  ]
  if (html) parts.push(`--${boundary}`, 'Content-Type: text/html; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', wrapBase64(html))
  parts.push(`--${boundary}--`, '')
  return `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`
}

/** @param {{mime:string,threadId?:string,token:string,fetchImpl?:any}} options */
export async function gmailSend({ mime, threadId, token, fetchImpl = fetch }) {
  const response = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: base64url(mime), ...(threadId ? { threadId } : {}) }),
    signal: AbortSignal.timeout(20_000),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(body?.error?.message || `Gmail respondeu ${response.status}`), { code: response.status === 429 || response.status >= 500 ? 'GMAIL_TEMPORARY' : 'GMAIL_SEND_FAILED' })
  return { id: body.id, threadId: body.threadId }
}

/** Lê o fio da conversa e diz se o prospect respondeu ou se voltou como não entregue. */
/** @param {{threadId:string,sender:string,token:string,fetchImpl?:any}} options */
export async function gmailThreadStatus({ threadId, sender, token, fetchImpl = fetch }) {
  const response = await fetchImpl(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=From&metadataHeaders=Message-ID&metadataHeaders=Date`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) return { replied: false, bounced: false, messages: 0 }
  const body = await response.json().catch(() => ({}))
  const messages = body.messages || []
  const header = (message, name) => (message.payload?.headers || []).find((item) => item.name?.toLowerCase() === name.toLowerCase())?.value || ''
  const lowerSender = String(sender || '').toLowerCase()
  let replied = false, bounced = false, lastMessageId = '', replySnippet = ''
  for (const message of messages) {
    const from = header(message, 'From').toLowerCase()
    lastMessageId = header(message, 'Message-ID') || lastMessageId
    if (from.includes(lowerSender)) continue
    if (/mailer-daemon|postmaster|mail delivery/i.test(from)) bounced = true
    else { replied = true; replySnippet = message.snippet || replySnippet }
  }
  return { replied, bounced, messages: messages.length, lastMessageId, replySnippet }
}
