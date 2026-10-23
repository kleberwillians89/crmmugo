import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  attributionLabel, confirmUrl, confirmationAllowed, confirmationEmail, leadTaskNotes, normalizePhone, pickAttribution,
  summarizeSignups, tokenExpired, validateSignup, welcomeEmail,
} from '../supabase/functions/_shared/newsletterSignupCore.js'

const now = Date.parse('2026-10-23T19:00:00Z')
const base = { name: 'Ana Souza', email: ' Ana@Loja.com.BR ', consent: true, started_at: now - 8000 }

test('inscrição válida normaliza e-mail e guarda a origem da campanha', () => {
  const r = validateSignup({ ...base, utm_source: 'meta', utm_medium: 'paid', utm_campaign: 'news-out', landing_url: 'https://crm.mugoagencia.com.br/news?utm_source=meta', referrer: 'javascript:alert(1)' }, now)
  assert.equal(r.ok, true)
  assert.equal(r.value.email, 'ana@loja.com.br')
  assert.deepEqual(r.value.attribution, { utm_source: 'meta', utm_medium: 'paid', utm_campaign: 'news-out', landing_url: 'https://crm.mugoagencia.com.br/news?utm_source=meta' })
  assert.equal(r.value.wants_contact, false)
  assert.equal(r.value.phone, null)
})

test('sem aceite, sem nome ou e-mail ruim: devolve o campo com problema', () => {
  assert.deepEqual(validateSignup({ ...base, consent: false }, now).errors, ['consent'])
  assert.deepEqual(validateSignup({ ...base, email: 'ana@loja' }, now).errors, ['email'])
  assert.deepEqual(validateSignup({ ...base, name: ' ' }, now).errors, ['name'])
})

test('robôs: campo escondido preenchido ou envio rápido demais', () => {
  assert.equal(validateSignup({ ...base, website: 'http://spam' }, now).bot, true)
  assert.equal(validateSignup({ ...base, started_at: now - 500 }, now).bot, true)
  assert.equal(validateSignup({ ...base, started_at: undefined }, now).bot, true)
})

test('pedido de contato exige WhatsApp com DDD', () => {
  assert.deepEqual(validateSignup({ ...base, wants_contact: true, whatsapp: '98888-7777' }, now).errors, ['whatsapp'])
  const ok = validateSignup({ ...base, wants_contact: true, whatsapp: '(11) 98888-7777', company: 'Loja X', interest: 'Tráfego pago' }, now)
  assert.equal(ok.value.phone, '5511988887777')
  assert.equal(ok.value.company, 'Loja X')
})

test('telefone brasileiro em vários formatos', () => {
  assert.equal(normalizePhone('+55 11 98888-7777'), '5511988887777')
  assert.equal(normalizePhone('1133334444'), '551133334444')
  assert.equal(normalizePhone('0055 11 98888 7777'), '5511988887777')
  assert.equal(normalizePhone('123'), null)
})

test('rótulo da origem', () => {
  assert.equal(attributionLabel({ utm_source: 'meta', utm_medium: 'paid', utm_campaign: 'news-out' }), 'meta / paid · news-out')
  assert.equal(attributionLabel({ fbclid: 'x' }), 'meta (sem UTM)')
  assert.equal(attributionLabel({ referrer: 'https://www.instagram.com/mugo' }), 'instagram.com')
  assert.equal(attributionLabel({}), 'direto')
  assert.deepEqual(pickAttribution({ utm_term: 'x'.repeat(400) }).utm_term.length, 200)
})

test('reenvio do e-mail de confirmação tem limite', () => {
  assert.equal(confirmationAllowed(null, now), true)
  assert.equal(confirmationAllowed({ confirmation_sent_at: new Date(now - 5 * 60_000).toISOString(), confirmations_sent: 1 }, now), false)
  assert.equal(confirmationAllowed({ confirmation_sent_at: new Date(now - 15 * 60_000).toISOString(), confirmations_sent: 1 }, now), true)
  assert.equal(confirmationAllowed({ confirmation_sent_at: new Date(now - 15 * 60_000).toISOString(), confirmations_sent: 3 }, now), false)
  assert.equal(confirmationAllowed({ confirmation_sent_at: new Date(now - 25 * 3600_000).toISOString(), confirmations_sent: 3 }, now), true)
})

test('link de confirmação vale 7 dias', () => {
  assert.equal(tokenExpired({ created_at: new Date(now - 6 * 86400_000).toISOString() }, now), false)
  assert.equal(tokenExpired({ created_at: new Date(now - 8 * 86400_000).toISOString() }, now), true)
  assert.equal(confirmUrl('https://crm.mugoagencia.com.br/news/', 'abc'), 'https://crm.mugoagencia.com.br/news/confirmar?c=abc')
})

test('e-mails escapam o nome e trazem os links certos', () => {
  const c = confirmationEmail({ name: '<b>Ana</b> Souza', url: 'https://x/confirmar?c=1' })
  assert.match(c.html, /Oi, &lt;b&gt;Ana&lt;\/b&gt;!/)
  assert.match(c.html, /href="https:\/\/x\/confirmar\?c=1"/)
  assert.match(c.text, /Oi, <b>Ana<\/b>!/)
  const w = welcomeEmail({ name: 'Ana', unsubscribeUrl: 'https://u/unsub?t=1' })
  assert.match(w.html, /href="https:\/\/u\/unsub\?t=1"/)
  assert.match(w.subject, /Inscrição confirmada/)
  assert.doesNotMatch(confirmationEmail({ name: '', url: 'u' }).html, /Oi, !/)
})

test('notas do lead para o comercial', () => {
  const notes = leadTaskNotes({ email: 'a@b.com', phone: '5511988887777', company: 'Loja X', interest: 'Tráfego pago', attribution: { utm_source: 'meta', utm_campaign: 'news' } })
  assert.match(notes, /WhatsApp: \+5511988887777/)
  assert.match(notes, /Origem: meta · news/)
})

test('resumo por campanha', () => {
  const s = summarizeSignups([
    { status: 'confirmed', wants_contact: true, attribution: { utm_source: 'meta', utm_campaign: 'a' }, confirmed_at: new Date(now - 86400_000).toISOString() },
    { status: 'pending', attribution: { utm_source: 'meta', utm_campaign: 'a' }, created_at: new Date(now).toISOString() },
    { status: 'confirmed', attribution: {}, confirmed_at: new Date(now - 30 * 86400_000).toISOString() },
  ], now)
  assert.equal(s.confirmed, 2); assert.equal(s.pending, 1); assert.equal(s.week, 1); assert.equal(s.leads, 1)
  assert.deepEqual(s.origins[0], { origin: 'meta · a', total: 2, confirmed: 1, contact: 1 })
})

test('página pública: aceite obrigatório, campo isca, UTMs e endpoint certo', () => {
  const html = readFileSync(new URL('../public/news/index.html', import.meta.url), 'utf8')
  assert.match(html, /name="consent" required/)
  assert.match(html, /class="hp"/)
  assert.match(html, /utm_campaign/)
  assert.match(html, /functions\/v1\/newsletter-signup/)
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
  const idx = (src) => vercel.routes.findIndex((r) => r.src === src)
  assert.ok(idx('/news/?') >= 0 && idx('/news/?') < vercel.routes.findIndex((r) => r.handle === 'filesystem'))
  const config = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8')
  assert.match(config, /\[functions\.newsletter-signup\]\nverify_jwt = false/)
})
