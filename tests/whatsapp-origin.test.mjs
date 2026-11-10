import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { extractEntryCode, extractOriginTouch, phoneKey, phoneKeySource } from '../supabase/functions/_shared/whatsappOrigin.js'

const webhook = fs.readFileSync(new URL('../supabase/functions/whatsapp-webhook/index.ts', import.meta.url), 'utf8')
const migration = fs.readFileSync(new URL('../supabase/migrations/202611090001_whatsapp_origem_anuncio.sql', import.meta.url), 'utf8')

test('anúncio Click-to-WhatsApp: guarda o ID do anúncio e o ctwa_clid', () => {
  const touch = extractOriginTouch({ referral: {
    source_type: 'ad', source_id: '120212345678901234', source_url: 'https://fb.me/abc?utm_campaign=bf26',
    headline: 'Kit Black Friday', body: 'Frete grátis', media_type: 'video', ctwa_clid: 'ARAkLk_xyz',
  } }, 'Oi! Ainda tem?')
  assert.equal(touch.source, 'META_ADS_WHATSAPP')
  assert.equal(touch.ad_id, '120212345678901234')
  assert.equal(touch.ctwa_clid, 'ARAkLk_xyz')
  assert.equal(touch.headline, 'Kit Black Friday')
  assert.equal(touch.utm.utm_campaign, 'bf26')
  assert.equal(touch.entry_code, null)
})

test('post orgânico manda source_id, mas não é anúncio: ad_id fica nulo', () => {
  const touch = extractOriginTouch({ referral: { source_type: 'post', source_id: '987654', source_url: 'https://instagram.com/p/x' } })
  assert.equal(touch.ad_id, null)
  assert.notEqual(touch.source, 'META_ADS_WHATSAPP')
})

test('código de entrada de link/QR no texto pré-preenchido', () => {
  assert.equal(extractEntryCode('Oi! Vim pela loja (ref:loja-qr)'), 'loja-qr')
  assert.equal(extractEntryCode('Olá ref: Bio_Insta'), 'bio_insta')
  assert.equal(extractEntryCode('Tem o tênis ref 4432 no 38?'), null)
  assert.equal(extractEntryCode('ref:4432'), null)
  assert.equal(extractEntryCode('preferência de cor'), null)
  assert.equal(extractEntryCode('referencia do produto'), null)
  const touch = extractOriginTouch({}, 'Oi! (ref:site-botao)')
  assert.equal(touch.source, 'ENTRY_CODE')
  assert.equal(touch.entry_code, 'site-botao')
})

test('sem referral e sem código: nenhuma origem inventada', () => {
  assert.equal(extractOriginTouch({ text: { body: 'oi' } }, 'oi'), null)
})

test('chave de telefone: celular BR com e sem 9º dígito vira a mesma chave', async () => {
  assert.equal(phoneKeySource('5511993161161'), phoneKeySource('551193161161'))
  assert.equal(phoneKeySource('(11) 99316-1161'), phoneKeySource('5511993161161'))
  assert.equal(phoneKeySource('+55 11 99316-1161'), '551193161161')
  assert.equal(await phoneKey('5511993161161'), await phoneKey('+55 (11) 9316-1161'))
  assert.equal((await phoneKey('5511993161161')).length, 32)
  assert.equal(await phoneKey('12'), null)
  // DDD 55 sem código do país (pedido) casa com o wa_id internacional.
  assert.equal(await phoneKey('(55) 99123-4567'), await phoneKey('5555991234567', { international: true }))
  assert.equal(await phoneKey('5511993161161', { international: true }), await phoneKey('5511993161161'))
  // Mesmo valor que o MUGOVERSO calcula (server/tests/test_whatsapp_insights.py).
  assert.equal(await phoneKey('5511993161161'), '8da0ce4f7795d49d1331629bcee13398')
})

test('webhook grava o toque só para cliente, sem duplicar e sem derrubar o atendimento', () => {
  assert.match(webhook, /const touch = senderType === 'customer' \? extractOriginTouch\(message, content\.body \|\| ''\) : null/)
  assert.match(webhook, /onConflict: 'connection_id,provider_message_id', ignoreDuplicates: true/)
  assert.match(webhook, /if \(touchResult\.error\) console\.log/)
})

test('migration: conexão da marca checa o cliente e toques têm RLS', () => {
  assert.match(migration, /add column if not exists client_id uuid references public\.clients\(id\)/)
  assert.match(migration, /raise exception 'WhatsApp connection client mismatch'/)
  assert.match(migration, /alter table public\.whatsapp_contact_touches force row level security/)
  assert.match(migration, /unique \(connection_id, provider_message_id\)/)
})
