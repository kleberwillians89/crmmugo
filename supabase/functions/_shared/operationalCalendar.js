const clean = (value) => String(value ?? '').trim()
const isoDate = (zone, at = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(at)
const hhmm = (zone, at = new Date()) => new Intl.DateTimeFormat('en-GB', {
  timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(at)
const weekday = (zone, at = new Date()) => new Intl.DateTimeFormat('en-US', {
  timeZone: zone, weekday: 'short',
}).format(at)
const minutes = (value) => {
  const [hour, minute] = clean(value).slice(0, 5).split(':').map(Number)
  return hour * 60 + minute
}
// Não existe (ainda) coluna de horário comercial configurável por organização no schema atual, nem
// tabela de feriados/exceções — só organization_settings.timezone. Enquanto isso não for modelado (e
// nenhuma migration foi aplicada para isto), o horário de atendimento é fixo para todas as
// organizações: dias úteis (seg-sex), 08:00–20:00 no fuso da organização.
const BUSINESS_START = '08:00', BUSINESS_END = '20:00'

// Usado por commercial-ai-worker (decidir se o handoff está dentro do horário de atendimento) e por
// collection-notification-worker (janela de disparo de cobrança). Só lê organization_settings.timezone
// — nenhuma outra coluna/tabela ainda existe para isto.
export async function getOperationalWindow(admin, organizationId, at = new Date()) {
  const settings = await admin.from('organization_settings').select('timezone').eq('organization_id', organizationId).maybeSingle()
  if (settings.error) throw settings.error
  const zone = settings.data?.timezone || 'America/Sao_Paulo'
  const localDate = isoDate(zone, at)
  const localTime = hhmm(zone, at)
  const businessDay = !['Sat', 'Sun'].includes(weekday(zone, at))
  const withinHours = minutes(localTime) >= minutes(BUSINESS_START) && minutes(localTime) < minutes(BUSINESS_END)
  return { zone, localDate, localTime, start: BUSINESS_START, end: BUSINESS_END, businessDay, open: businessDay && withinHours }
}
