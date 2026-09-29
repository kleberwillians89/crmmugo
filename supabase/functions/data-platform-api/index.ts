// Ponte read-only CRM Mugô -> Mugô Dados. Nunca expõe service_role, nunca aceita JWT de usuário final,
// nunca recebe organization_id diretamente do chamador (só external_client_id, resolvido via
// external_integrations). Ver docs/CRM_DATA_BRIDGE.md para o funil canônico e o modelo de segurança.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const text = (value: unknown, max = 300) => String(value ?? '').trim().slice(0, max)
const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
const clampLimit = (value: unknown, fallback = 100, max = 500) => Math.min(Math.max(Number(value) || fallback, 1), max)

const dayStart = (date: string) => `${date}T00:00:00.000Z`
const dayEnd = (date: string) => `${date}T23:59:59.999Z`

async function handleFunnel(admin: any, org: string, start: string, end: string) {
  const [opportunities, proposals] = await Promise.all([
    admin.from('commercial_opportunities').select('id,stage').eq('organization_id', org).gte('entered_at', dayStart(start)).lte('entered_at', dayEnd(end)),
    admin.from('proposals').select('id,status').eq('organization_id', org).not('sent_at', 'is', null).gte('sent_at', start).lte('sent_at', end),
  ])
  if (opportunities.error) throw opportunities.error
  if (proposals.error) throw proposals.error
  const opportunityIds = opportunities.data.map((row: any) => row.id)
  const qualifications = opportunityIds.length
    ? await admin.from('commercial_qualifications').select('opportunity_id').in('opportunity_id', opportunityIds).eq('qualified', true)
    : { data: [], error: null }
  if (qualifications.error) throw qualifications.error
  return json({
    ok: true,
    data: {
      period: { start, end },
      leads: opportunities.data.length,
      qualified_leads: qualifications.data.length,
      opportunities: opportunities.data.filter((row: any) => row.stage !== 'new_lead').length,
      proposals: proposals.data.length,
      won_sales: proposals.data.filter((row: any) => row.status === 'won').length,
      lost_sales: proposals.data.filter((row: any) => row.status === 'lost').length,
    },
  })
}

async function handleAttribution(admin: any, org: string, start: string, end: string, limit: number) {
  const opportunities = await admin.from('commercial_opportunities')
    .select('id,source,campaign,utm_source,utm_medium,utm_campaign,stage')
    .eq('organization_id', org).gte('entered_at', dayStart(start)).lte('entered_at', dayEnd(end))
  if (opportunities.error) throw opportunities.error
  const opportunityIds = opportunities.data.map((row: any) => row.id)
  const qualifications = opportunityIds.length
    ? await admin.from('commercial_qualifications').select('opportunity_id').in('opportunity_id', opportunityIds).eq('qualified', true)
    : { data: [], error: null }
  if (qualifications.error) throw qualifications.error
  const qualifiedIds = new Set((qualifications.data || []).map((row: any) => row.opportunity_id))
  const groups = new Map<string, any>()
  for (const row of opportunities.data) {
    // Origem desconhecida permanece desconhecida — nunca adivinha um canal quando não há UTM/fonte.
    const key = JSON.stringify([row.source || null, row.campaign || null, row.utm_source || null, row.utm_medium || null, row.utm_campaign || null])
    if (!groups.has(key)) groups.set(key, { source: row.source || null, campaign: row.campaign || null, utm_source: row.utm_source || null, utm_medium: row.utm_medium || null, utm_campaign: row.utm_campaign || null, leads: 0, qualified_leads: 0, won_sales: 0 })
    const group = groups.get(key)
    group.leads += 1
    if (qualifiedIds.has(row.id)) group.qualified_leads += 1
    if (row.stage === 'won') group.won_sales += 1
  }
  return json({ ok: true, data: { period: { start, end }, groups: [...groups.values()].slice(0, limit) } })
}

async function handleRevenue(admin: any, org: string, start: string, end: string) {
  const [proposals, installments] = await Promise.all([
    // Revenue = proposta GANHA (valor contratado). Nunca inferido de conversa; proposal != sale.
    admin.from('proposals').select('total_value').eq('organization_id', org).eq('status', 'won').not('closed_at', 'is', null).gte('closed_at', start).lte('closed_at', end),
    // Received revenue = dinheiro que realmente entrou (parcela paga). Sale != received cash;
    // collection != payment — cobrança enviada nunca conta como receita.
    admin.from('invoice_installments').select('amount,original_amount,currency').eq('organization_id', org).eq('status', 'paid').gte('paid_at', dayStart(start)).lte('paid_at', dayEnd(end)),
  ])
  if (proposals.error) throw proposals.error
  if (installments.error) throw installments.error
  const revenueBrl = proposals.data.reduce((sum: number, row: any) => sum + Number(row.total_value || 0), 0)
  const receivedByCurrency: Record<string, number> = {}
  for (const row of installments.data) {
    const currency = row.currency || 'BRL'
    // EUR sem câmbio configurado grava amount=0 (ver normalize_receivable_currency) — o valor real é
    // sempre original_amount para não-BRL. Nunca converte, nunca soma moedas diferentes.
    const value = currency === 'BRL' ? Number(row.amount || 0) : Number(row.original_amount || 0)
    receivedByCurrency[currency] = (receivedByCurrency[currency] || 0) + value
  }
  return json({ ok: true, data: { period: { start, end }, revenue_brl: revenueBrl, received_revenue: receivedByCurrency } })
}

Deno.serve(async (request: Request) => {
  const startedAt = Date.now()
  if (request.method !== 'GET') return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405)
  const url = new URL(request.url)
  const expectedKey = Deno.env.get('DATA_PLATFORM_API_KEY') || ''
  if (!expectedKey || request.headers.get('X-Data-Platform-Key') !== expectedKey) return json({ ok: false, code: 'UNAUTHORIZED' }, 401)
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!supabaseUrl || !serviceKey) return json({ ok: false, code: 'CONFIGURATION_MISSING' }, 503)
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  const externalClientId = text(url.searchParams.get('external_client_id'), 200)
  const periodStart = text(url.searchParams.get('period_start'), 10)
  const periodEnd = text(url.searchParams.get('period_end'), 10)
  const limit = clampLimit(url.searchParams.get('limit'))
  const endpoint = url.pathname.split('/').filter(Boolean).pop() || ''
  if (!externalClientId) return json({ ok: false, code: 'EXTERNAL_CLIENT_ID_REQUIRED' }, 400)
  if (!isIsoDate(periodStart) || !isIsoDate(periodEnd)) return json({ ok: false, code: 'INVALID_PERIOD' }, 400)
  if (periodEnd < periodStart) return json({ ok: false, code: 'INVALID_PERIOD_RANGE' }, 400)

  // Nunca aceita organization_id do chamador — resolve sempre pelo vínculo explícito, nunca por nome.
  const integration = await admin.from('external_integrations').select('organization_id')
    .eq('provider', 'mugo_dados').eq('external_client_id', externalClientId).eq('status', 'active').maybeSingle()
  if (integration.error) {
    console.log(JSON.stringify({ event: 'data_platform_lookup_failed', endpoint, duration_ms: Date.now() - startedAt }))
    return json({ ok: false, code: 'LOOKUP_FAILED' }, 500)
  }
  if (!integration.data) return json({ ok: false, code: 'UNKNOWN_EXTERNAL_CLIENT' }, 403)
  const organizationId = integration.data.organization_id

  try {
    let response: Response
    if (endpoint === 'funnel') response = await handleFunnel(admin, organizationId, periodStart, periodEnd)
    else if (endpoint === 'attribution') response = await handleAttribution(admin, organizationId, periodStart, periodEnd, limit)
    else if (endpoint === 'revenue') response = await handleRevenue(admin, organizationId, periodStart, periodEnd)
    else return json({ ok: false, code: 'NOT_FOUND' }, 404)
    // Log nunca carrega PII/conteúdo — só organização (id), endpoint e duração, igual ao padrão de
    // auditOperation já usado em mugozap-api.
    console.log(JSON.stringify({ event: 'data_platform_request', organization_id: organizationId, endpoint, status_http: response.status, duration_ms: Date.now() - startedAt }))
    return response
  } catch (error) {
    console.log(JSON.stringify({ event: 'data_platform_query_failed', organization_id: organizationId, endpoint, error_code: text((error as any)?.code || (error as any)?.message, 120) }))
    return json({ ok: false, code: 'QUERY_FAILED' }, 500)
  }
})
