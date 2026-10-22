import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import { CURATION_SCHEMA, composeLinkedinPost, generationDue, newsHooksFor, nextSendAt, parseFeed, renderLinkedinSlides, renderNewsletterHtml, validateCuration, weekStart } from '../supabase/functions/_shared/newsletterCore.js'
import { openAiStrictSchema } from '../supabase/functions/_shared/aiProvider.js'

const rss = `<?xml version="1.0"?><rss><channel><title>X</title>
<item><title><![CDATA[Meta lança novo formato &amp; mais]]></title><link>https://ex.com/a</link><pubDate>Tue, 20 Oct 2026 12:00:00 GMT</pubDate><description><![CDATA[<p>Trecho <b>A</b></p>]]></description></item>
<item><title>Sem link</title></item>
<item><title>Google muda SEO</title><link>https://ex.com/b</link><pubDate>Mon, 19 Oct 2026 10:00:00 GMT</pubDate><description>Trecho B</description></item>
<item><title>Cortado</title><link>https://ex.com/c</link><descr`
const atom = `<feed><entry><title>Atom post</title><link rel="alternate" href="https://ex.com/atom"/><updated>2026-10-21T09:00:00Z</updated><summary>Resumo</summary></entry></feed>`

test('RSS e Atom, tolerando feed truncado', () => {
  const items = parseFeed(rss)
  assert.deepEqual(items.map((i) => i.url), ['https://ex.com/a', 'https://ex.com/b'])
  assert.equal(items[0].title, 'Meta lança novo formato & mais')
  assert.equal(items[0].excerpt, 'Trecho A')
  assert.equal(items[0].published_at, '2026-10-20T12:00:00.000Z')
  assert.equal(parseFeed(atom)[0].url, 'https://ex.com/atom')
})

test('agenda: semana, geração na segunda 7h e envio na terça 9h (Brasília)', () => {
  assert.equal(weekStart(new Date('2026-10-22T15:00:00Z')), '2026-10-19')
  assert.equal(weekStart(new Date('2026-10-19T02:00:00Z')), '2026-10-12') // domingo 23h BRT
  const settings = { enabled: true, generate_weekday: 1, generate_time: '07:00', send_weekday: 2, send_time: '09:00' }
  assert.equal(generationDue(settings, new Date('2026-10-19T09:59:00Z')), false) // seg 06:59
  assert.equal(generationDue(settings, new Date('2026-10-19T10:01:00Z')), true)  // seg 07:01
  assert.equal(generationDue(settings, new Date('2026-10-22T10:00:00Z')), true)  // qui
  assert.equal(generationDue({ ...settings, enabled: false }, new Date('2026-10-22T10:00:00Z')), false)
  assert.equal(nextSendAt(settings, new Date('2026-10-19T12:00:00Z')).toISOString(), '2026-10-20T12:00:00.000Z')
  assert.equal(nextSendAt(settings, new Date('2026-10-20T13:00:00Z')).toISOString(), '2026-10-27T12:00:00.000Z')
})

test('curadoria só aceita notícias da lista e exige 3+', () => {
  const candidates = ['a', 'b', 'c', 'd'].map((k) => ({ id: k, url: `https://ex.com/${k}`, title: k, source_name: 'Fonte' }))
  const raw = { subject: 'Assunto', preheader: 'p', intro: 'i', linkedin_post: 'Post', items: [
    { url: 'https://ex.com/a', title_pt: 'A', summary_pt: 'sa', impact_pt: 'ia', segments: ['ecommerce'] },
    { url: 'https://inventado.com/x', title_pt: 'X', summary_pt: 'sx', impact_pt: 'ix', segments: [] },
    { url: 'https://ex.com/a', title_pt: 'A2', summary_pt: 'dup', impact_pt: '', segments: [] },
    { url: 'https://ex.com/b', title_pt: 'B', summary_pt: 'sb', impact_pt: 'ib', segments: ['todos'] },
    { url: 'https://ex.com/c', title_pt: 'C', summary_pt: 'sc', impact_pt: 'ic', segments: ['nada'] },
  ] }
  const edition = validateCuration(raw, candidates, 5)
  assert.deepEqual(edition.items.map((i) => i.url), ['https://ex.com/a', 'https://ex.com/b', 'https://ex.com/c'])
  assert.equal(edition.items[0].news_id, 'a')
  assert.deepEqual(edition.items[2].segments, [])
  assert.equal(edition.linkedin_post, 'Post')
  assert.equal(validateCuration({ items: raw.items.slice(0, 2) }, candidates), null)
  const strict = openAiStrictSchema(CURATION_SCHEMA)
  assert.deepEqual(strict.required.sort(), Object.keys(strict.properties).sort())
})

test('HTML do e-mail e slides do LinkedIn com os layouts de vocês', () => {
  const edition = { week_start: '2026-10-19', subject: 'Semana <IA>', intro: 'Oi', preheader: 'pre', items: [{ url: 'https://ex.com/a', title_pt: 'Título & cia', summary_pt: 'Resumo', impact_pt: 'Impacto', source_name: 'Fonte' }] }
  const html = renderNewsletterHtml({ template: '<main>{{intro}}|{{itens}}|{{nome}}</main>', itemTemplate: '<h2>{{titulo}}</h2><a href="{{link}}">{{fonte}}</a>', edition })
  assert.equal(html, '<main>Oi|<h2>Título &amp; cia</h2><a href="https://ex.com/a">Fonte</a>|{{nome}}</main>')
  assert.match(renderNewsletterHtml({ edition }), /\{\{descadastro\}\}/)
  const slides = renderLinkedinSlides({ coverTemplate: '<div>{{titulo_edicao}} {{data}}</div>', slideTemplate: '<div>{{numero}} {{titulo}}</div>', edition })
  assert.deepEqual(slides, ['<div>Semana &lt;IA&gt; 19/10/2026</div>', '<div>01/01 Título &amp; cia</div>'])
  assert.match(renderLinkedinSlides({ edition })[0], /width:1080px;height:1350px/)
  assert.equal(composeLinkedinPost({ linkedin_post: 'Post sobre #ecommerce' }, '#marketingdigital ecommerce'), 'Post sobre #ecommerce\n\n#marketingdigital')
})

test('ganchos da semana para a prospecção por segmento', () => {
  const news = [{ title: 'A', summary_pt: 'a', segments: ['ecommerce'] }, { title: 'B', summary_pt: 'b', segments: ['investimentos'] }, { title: 'C', summary_pt: 'c', segments: ['todos'] }, { title: 'D', summary_pt: null, segments: ['ecommerce'] }]
  assert.deepEqual(newsHooksFor(news, 'E-commerce de moda').map((n) => n.titulo), ['A', 'C'])
  assert.deepEqual(newsHooksFor(news, 'Gestora de investimentos').map((n) => n.titulo), ['B', 'C'])
  assert.equal(newsHooksFor(news, '').length, 3)
})

test('newsletter nunca envia sem aprovação por padrão', () => {
  const sql = fs.readFileSync('supabase/migrations/202610220002_newsletter_automatica.sql', 'utf8')
  assert.match(sql, /auto_send boolean not null default false/)
  assert.match(sql, /enabled boolean not null default false/)
})

test('aprovação atrasada não empurra o envio para a semana seguinte', async () => {
  const { sendAtAfterApproval } = await import('../supabase/functions/_shared/newsletterCore.js')
  const s = { send_weekday: 2, send_time: '09:00' }
  const at = (iso) => sendAtAfterApproval(s, new Date(iso)).toISOString()
  assert.equal(at('2026-10-19T14:00:00Z'), '2026-10-20T12:00:00.000Z') // aprovada seg 11h → ter 9h
  assert.equal(at('2026-10-20T11:00:00Z'), '2026-10-20T12:00:00.000Z') // ter 8h → ter 9h
  assert.equal(at('2026-10-20T15:00:00Z'), '2026-10-21T12:00:00.000Z') // ter 12h (atrasou) → qua 9h
  assert.equal(at('2026-10-23T18:00:00Z'), '2026-10-26T12:00:00.000Z') // sex 15h → seg 9h
})

test('lembrete 1h15 antes do envio e validade até quarta 12h', async () => {
  const { reminderDue, expiryDue, FLASH_SCHEMA } = await import('../supabase/functions/_shared/newsletterCore.js')
  const s = { send_weekday: 2, send_time: '09:00' }
  const edition = { status: 'draft', week_start: '2026-10-19', reminded_at: null }
  assert.equal(reminderDue(s, edition, new Date('2026-10-20T10:40:00Z')), false) // ter 07:40
  assert.equal(reminderDue(s, edition, new Date('2026-10-20T10:46:00Z')), true)  // ter 07:46
  assert.equal(reminderDue(s, { ...edition, reminded_at: 'x' }, new Date('2026-10-20T11:00:00Z')), false)
  assert.equal(reminderDue(s, { ...edition, status: 'approved' }, new Date('2026-10-20T11:00:00Z')), false)
  assert.equal(expiryDue(s, edition, new Date('2026-10-21T14:59:00Z')), false) // qua 11:59
  assert.equal(expiryDue(s, edition, new Date('2026-10-21T15:00:00Z')), true)  // qua 12:00
  assert.equal(expiryDue(s, { ...edition, status: 'approved' }, new Date('2026-10-22T15:00:00Z')), false)
  assert.deepEqual(FLASH_SCHEMA.required, ['title_pt', 'summary_pt', 'impact_pt', 'linkedin_post'])
})

test('cron pula a semana não aprovada e escala a tarefa para o resumo do WhatsApp', () => {
  const fn = fs.readFileSync('supabase/functions/newsletter/index.ts', 'utf8')
  assert.match(fn, /expiryDue\(settings,current\.data\)[\s\S]*status:'skipped'/)
  assert.match(fn, /reminderDue\(settings,current\.data\)[\s\S]*priority:'critical',due_date:today\(\)/)
  assert.match(fn, /action==='approve_now'[\s\S]*approveEdition\(admin,config,edition\.data,user\.data\.user\.id,true\)/)
})

test('notícias: usa o trecho mais completo do feed, tira rodapé automático e lê a página quando o feed é curto', async () => {
  const { parseFeed, bestExcerpt, extractArticleText } = await import('../supabase/functions/_shared/newsletterCore.js')
  const xml = `<rss><channel><item><title>Meta lança IA</title><link>https://about.fb.com/x</link>
    <description><![CDATA[<img src="a.jpg"> The post Meta lança IA appeared first on Meta Newsroom.]]></description>
    <content:encoded><![CDATA[<p>A Meta anunciou hoje uma ferramenta de IA para anunciantes que cria variações de criativos automaticamente.</p><p>O recurso chega ao Brasil em novembro.</p>]]></content:encoded>
    <pubDate>Thu, 22 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>`
  const [item] = parseFeed(xml)
  assert.match(item.excerpt, /ferramenta de IA para anunciantes/)
  assert.doesNotMatch(item.excerpt, /appeared first/)
  assert.equal(bestExcerpt(['', 'curto', 'um texto bem mais longo']), 'um texto bem mais longo')
  const html = `<html><head><meta property="og:description" content="Google muda regras do Performance Max para varejo."><script>var x=1</script></head>
    <body><nav><p>Assine nossa newsletter e receba novidades toda semana no seu e-mail.</p></nav>
    <article><p>O Google anunciou mudanças no Performance Max que afetam campanhas de varejo a partir de dezembro.</p>
    <p>Anunciantes poderão excluir marcas e ver relatórios por canal, algo pedido há anos pelo mercado.</p></article></body></html>`
  const text = extractArticleText(html)
  assert.match(text, /^Google muda regras/)
  assert.match(text, /relatórios por canal/)
  assert.doesNotMatch(text, /Assine/)
  assert.ok(extractArticleText(html, { max: 80 }).length <= 80)
})
