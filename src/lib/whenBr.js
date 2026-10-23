// Datas relativas curtas em horário de São Paulo, para mostrar "quando foi a última atualização".
const dayKey = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(ms))
const hourBr = (ms) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(new Date(ms))
/** "hoje às 14:45", "ontem às 09:10" ou "21/10 às 18:00". */
export function whenBr(iso, now) {
  const ms = Date.parse(iso || '')
  if (!Number.isFinite(ms)) return 'nunca'
  if (dayKey(ms) === dayKey(now)) return `hoje às ${hourBr(ms)}`
  if (dayKey(ms) === dayKey(now - 86_400_000)) return `ontem às ${hourBr(ms)}`
  return `${new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(new Date(ms))} às ${hourBr(ms)}`
}
