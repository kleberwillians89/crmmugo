import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import { LINKEDIN_NOTE_LIMIT, buildResearchPrompt, extractSiteSignals, nextSendSlot, normalizeResearch, personalize, planSequence, renderOutreachHtml } from '../supabase/functions/_shared/prospectingCore.js'
import { buildMimeMessage, gmailAccessToken, gmailThreadStatus } from '../supabase/functions/_shared/gmail.js'
import { matchesAudience, renderCampaignHtml, shouldAdvanceRecipient, unsubscribeUrl, verifySvixSignature } from '../supabase/functions/_shared/emailMarketingCore.js'
import { normalizeProspectRow, parseCsv } from '../src/lib/prospectCsv.js'

const brt = (date) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)

test('envio só em dia útil e dentro da janela (horário de Brasília)', () => {
  const settings = { send_window_start: '08:30', send_window_end: '18:00' }
  // sábado 10h BRT → segunda 08:30
  const saturday = nextSendSlot(new Date('2026-10-24T13:00:00Z'), settings)
  assert.match(brt(saturday), /seg\.?,? 08:30/)
  // quinta 19h BRT → sexta 08:30
  assert.match(brt(nextSendSlot(new Date('2026-10-22T22:00:00Z'), settings)), /sex\.?,? 08:30/)
  // quinta 10h BRT → agora mesmo
  const now = new Date('2026-10-22T13:00:00Z')
  assert.equal(nextSendSlot(now, settings).getTime(), now.getTime())
})

test('sequência: e-mail 1 + follow-ups no mesmo fio, em dias úteis', () => {
  const steps = planSequence({
    prospect: { email_subject: 'ideia para a loja', email_body: 'Oi {{nome}}', email_followups: ['seguimento 1', 'seguimento 2'] },
    settings: { followup_days: [3, 7] }, now: new Date('2026-10-22T13:00:00Z'),
  })
  assert.equal(steps.length, 3)
  assert.equal(steps[1].subject, 'Re: ideia para a loja')
  assert.ok(steps[1].scheduled_for > steps[0].scheduled_for && steps[2].scheduled_for > steps[1].scheduled_for)
  for (const step of steps) assert.doesNotMatch(brt(step.scheduled_for), /s[áa]b|dom/)
  assert.equal(personalize('Oi {{nome}}, vi a {{empresa}}', { contact_name: 'Ana Souza', company_name: 'Loja X' }), 'Oi Ana, vi a Loja X')
})

test('pesquisa: nota do LinkedIn respeita 300 caracteres e links do LinkedIn são validados', () => {
  const result = normalizeResearch({ fit_score: 140, linkedin_note: 'a '.repeat(400), decision_maker: { name: 'Ana', role: 'CEO', linkedin_url: 'https://evil.com/x' }, followups: ['x', '', 'y', 'z'] })
  assert.equal(result.fit_score, 100)
  assert.ok(result.linkedin_note.length <= LINKEDIN_NOTE_LIMIT)
  assert.equal(result.decision_maker.linkedin_url, '')
  assert.deepEqual(result.followups, ['x', 'y'])
  const prompt = buildResearchPrompt({ prospect: { company_name: 'Loja X', website: 'lojax.com.br' }, settings: { icp: 'E-commerce de moda', offer: 'Diagnóstico gratuito' }, knowledge: [{ category: 'cases', title: 'Roupa', content: '+40% vendas' }] })
  assert.match(prompt.system, /E-commerce de moda/)
  assert.match(prompt.system, /Diagnóstico gratuito/)
  assert.match(prompt.user, /Loja X/)
})

test('mini-auditoria do site detecta plataforma, pixel e GA', () => {
  const html = '<html><head><title>Loja X</title><meta name="viewport" content="width=device-width"><script src="https://cdn.shopify.com/x.js"></script><script>gtag("config","G-1")</script></head><body><a href="https://wa.me/55119">Zap</a></body></html>'
  const signals = extractSiteSignals(html, { url: 'https://lojax.com.br', elapsedMs: 900 })
  assert.equal(signals.platform, 'Shopify')
  assert.equal(signals.meta_pixel, false)
  assert.equal(signals.google_analytics, true)
  assert.equal(signals.whatsapp_button, true)
  assert.equal(signals.meta_description, null)
})

test('HTML leve: corpo escapado, assinatura e variáveis', () => {
  const html = renderOutreachHtml({ template: '<div>{{corpo}}<hr>{{assinatura}} — {{empresa}}</div>', signature: '<b>Kleber</b>', bodyText: 'Oi Ana,\n\nvi <isso> no site.', prospect: { company_name: 'Loja & Cia' } })
  assert.match(html, /<p[^>]*>Oi Ana,<\/p><p[^>]*>vi &lt;isso&gt; no site\.<\/p>/)
  assert.match(html, /<b>Kleber<\/b> — Loja &amp; Cia/)
})

test('MIME do Gmail: multipart com texto e HTML, assunto com acento codificado', () => {
  const mime = buildMimeMessage({ from: 'kleber@x.com', fromName: 'Kléber', to: 'ana@y.com', subject: 'ideia rápida', text: 'olá', html: '<p>olá</p>', inReplyTo: '<abc@mail>' })
  assert.match(mime, /From: =\?UTF-8\?B\?[^?]+\?= <kleber@x\.com>/)
  assert.match(mime, /Subject: =\?UTF-8\?B\?/)
  assert.match(mime, /In-Reply-To: <abc@mail>/)
  assert.match(mime, /text\/plain[\s\S]*text\/html/)
})

test('Gmail: token por conta de serviço (JWT RS256) e leitura de resposta/bounce', async () => {
  const { privateKey } = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', privateKey)).toString('base64')
  const account = JSON.stringify({ client_email: 'sa@proj.iam.gserviceaccount.com', private_key: `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----\n` })
  let assertion = ''
  const token = await gmailAccessToken({ serviceAccountJson: account, sender: 'kleber@x.com', fetchImpl: async (_url, init) => { assertion = new URLSearchParams(init.body.toString()).get('assertion'); return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 })) } })
  assert.equal(token, 'tok')
  const claims = JSON.parse(Buffer.from(assertion.split('.')[1], 'base64url').toString())
  assert.equal(claims.sub, 'kleber@x.com')
  assert.match(claims.scope, /gmail\.send/)

  const thread = (froms) => async () => new Response(JSON.stringify({ messages: froms.map((from, i) => ({ snippet: `msg ${i}`, payload: { headers: [{ name: 'From', value: from }, { name: 'Message-ID', value: `<id${i}>` }] } })) }))
  assert.deepEqual(await gmailThreadStatus({ threadId: 't', sender: 'kleber@x.com', token: 'tok', fetchImpl: thread(['Kleber <kleber@x.com>']) }).then((r) => [r.replied, r.bounced]), [false, false])
  const replied = await gmailThreadStatus({ threadId: 't', sender: 'kleber@x.com', token: 'tok', fetchImpl: thread(['kleber@x.com', 'Ana <ana@y.com>']) })
  assert.equal(replied.replied, true)
  assert.equal(replied.replySnippet, 'msg 1')
  assert.equal(replied.lastMessageId, '<id1>')
  assert.equal((await gmailThreadStatus({ threadId: 't', sender: 'kleber@x.com', token: 'tok', fetchImpl: thread(['kleber@x.com', 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>']) })).bounced, true)
})

test('e-mail marketing: descadastro, público e assinatura do webhook', async () => {
  const link = unsubscribeUrl('https://abc.supabase.co/', 'tok-1')
  assert.equal(link, 'https://abc.supabase.co/functions/v1/email-unsubscribe?t=tok-1')
  const withFooter = renderCampaignHtml('<html><body><p>Oi {{nome}}</p></body></html>', { name: 'Ana Lima', unsubscribe: link })
  assert.match(withFooter, /Oi Ana/)
  assert.match(withFooter, /Descadastrar<\/a><\/div><\/body>/)
  assert.doesNotMatch(renderCampaignHtml('<a href="{{descadastro}}">sair</a>', { unsubscribe: link }), /Descadastrar/)

  assert.equal(matchesAudience({ email: 'a@b.com', subscribed: true, tags: ['cliente'], source: 'crm_client' }, { tags: ['cliente'] }), true)
  assert.equal(matchesAudience({ email: 'a@b.com', subscribed: true, tags: ['lead'], source: 'crm_lead' }, { tags: ['cliente'] }), false)
  assert.equal(matchesAudience({ email: 'a@b.com', subscribed: false, tags: [] }, {}), false)
  assert.equal(shouldAdvanceRecipient('opened', 'delivered'), false)
  assert.equal(shouldAdvanceRecipient('delivered', 'clicked'), true)

  const secretBytes = crypto.getRandomValues(new Uint8Array(24)), secret = `whsec_${Buffer.from(secretBytes).toString('base64')}`
  const body = '{"type":"email.opened"}', id = 'msg_1', timestamp = String(Math.floor(Date.now() / 1000))
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = `v1,${Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`))).toString('base64')}`
  assert.equal(await verifySvixSignature({ secret, id, timestamp, signature, body }), true)
  assert.equal(await verifySvixSignature({ secret, id, timestamp, signature, body: body + ' ' }), false)
  assert.equal(await verifySvixSignature({ secret, id, timestamp: '1000', signature, body }), false)
})

test('CSV de prospecção: Apollo, Casa dos Dados e planilha própria', () => {
  const apollo = parseCsv('First Name,Last Name,Title,Company,Email,Person Linkedin Url,Website,City,State\nAna,Souza,CEO,"Loja X, Ltda",ana@lojax.com,https://linkedin.com/in/ana,lojax.com.br,São Paulo,SP')
  const row = normalizeProspectRow(apollo[0])
  assert.equal(row.company_name, 'Loja X, Ltda')
  assert.equal(row.contact_name, 'Ana Souza')
  assert.equal(row.contact_role, 'CEO')
  assert.equal(row.contact_email, 'ana@lojax.com')
  assert.equal(row.contact_linkedin_url, 'https://linkedin.com/in/ana')
  const casa = normalizeProspectRow(parseCsv('razao_social;nome_fantasia;cnpj;email;telefone;municipio;uf\nX LTDA;Clínica Vida;12.345.678/0001-90;contato@vida.com;11999999999;Campinas;SP')[0])
  assert.equal(casa.company_name, 'Clínica Vida')
  assert.equal(casa.cnpj, '12345678000190')
  assert.equal(casa.city, 'Campinas')
  assert.equal(normalizeProspectRow({ Nome: '' }), null)
})

test('arquitetura: LinkedIn nunca é enviado por robô e prospecção fria não usa Resend', () => {
  const prospecting = fs.readFileSync('supabase/functions/prospecting/index.ts', 'utf8')
  assert.doesNotMatch(prospecting, /linkedin\.com\/voyager|api\.linkedin\.com/)
  assert.doesNotMatch(prospecting, /api\.resend\.com/)
  const campaigns = fs.readFileSync('supabase/functions/email-campaigns/index.ts', 'utf8')
  assert.match(campaigns, /from\('email_contacts'\)/)
  assert.doesNotMatch(campaigns, /from\('prospects'\)/)
})

test('respostas da prospecção: só interesse/dúvida viram oportunidade; saída bloqueia; automática não conta', async () => {
  const { classifyReplyHeuristic, resolveReplyCategory, replyOutcome } = await import('../supabase/functions/_shared/prospectingCore.js')
  const cases = {
    'Por favor, me remova da sua lista.': 'opt_out',
    'Não quero mais receber esses e-mails': 'opt_out',
    'Resposta automática: estou de férias até 03/11.': 'auto_reply',
    'Out of office until Monday': 'auto_reply',
    'Obrigado, mas não temos interesse no momento.': 'not_interested',
    'Já temos uma agência que cuida disso.': 'not_interested',
    'Tenho interesse, podemos conversar na quinta?': 'interested',
    'Quanto custa a gestão de tráfego?': 'question',
  }
  for (const [text, expected] of Object.entries(cases)) assert.equal(classifyReplyHeuristic(text).category, expected, text)
  // a IA não consegue "salvar" um pedido de saída nem uma resposta automática
  assert.equal(resolveReplyCategory({ category: 'interested', reason: 'x' }, 'me tira dessa lista por favor').category, 'opt_out')
  assert.equal(resolveReplyCategory({ category: 'question', reason: 'x' }, 'Olá! Pode me mandar uma proposta?').category, 'question')
  assert.equal(replyOutcome('opt_out').suppress, true)
  assert.equal(replyOutcome('opt_out').prospectStatus, 'do_not_contact')
  assert.equal(replyOutcome('not_interested').convert, false)
  assert.equal(replyOutcome('auto_reply').convert, false)
  assert.equal(replyOutcome('interested').convert, true)
  const conversion = fs.readFileSync('supabase/functions/_shared/prospectConversion.js', 'utf8')
  assert.match(conversion, /not\('stage', 'in', '\(won,lost\)'\)/)
  assert.match(conversion, /linked_to_existing_opportunity/)
})

test('newsletter da Mugô: modelo tem todos os campos e "Oi, {{nome}}" sem nome vira "Oi."', async () => {
  const { renderNewsletterHtml } = await import('../supabase/functions/_shared/newsletterCore.js')
  const tpl = fs.readFileSync('docs/newsletter/mugo-newsletter.html', 'utf8'), item = fs.readFileSync('docs/newsletter/mugo-newsletter-item.html', 'utf8')
  for (const field of ['{{preheader}}', '{{nome}}', '{{intro}}', '{{itens}}', '{{descadastro}}']) assert.ok(tpl.includes(field), field)
  for (const field of ['{{fonte}}', '{{titulo}}', '{{resumo}}', '{{impacto}}', '{{link}}']) assert.ok(item.includes(field), field)
  const html = renderCampaignHtml(renderNewsletterHtml({ template: tpl, itemTemplate: item, edition: { intro: 'x', preheader: 'p', items: [{ source_name: 'S', title_pt: 'T', summary_pt: 'R', impact_pt: 'I', url: 'https://a' }] } }), { name: '', unsubscribe: 'https://u' })
  assert.doesNotMatch(html, /\{\{[a-z_]+\}\}/)
  assert.match(html, /Oi\.<\/td>/)
  assert.equal((html.match(/Descadastrar/g) || []).length, 1)
  assert.match(renderCampaignHtml('<p>Oi, {{nome}}!</p>{{descadastro}}', { name: 'Ana Lima', unsubscribe: 'u' }), /Oi, Ana!/)
})
