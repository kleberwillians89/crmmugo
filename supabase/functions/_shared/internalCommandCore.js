const clean = (value) => String(value ?? '').trim()
export const foldText = (value) => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ')

export function normalizePhoneForWhatsApp(value) {
  const original=clean(value)
  let phone = original.replace(/\D/g, '')
  if (phone.startsWith('00')) phone = phone.slice(2)
  const explicitInternational=/^\s*\+|^\s*00/.test(original)
  if (!explicitInternational&&!phone.startsWith('55')&&/^[1-9]{2}(?:9\d{8}|\d{8})$/.test(phone)) phone = `55${phone}`
  if(phone.startsWith('55'))return /^55[1-9]{2}\d{8,9}$/.test(phone)?phone:''
  return /^[1-9]\d{7,14}$/.test(phone)?phone:''
}
export const normalizeBrazilianPhone=normalizePhoneForWhatsApp

// WhatsApp pode entregar números brasileiros antigos sem o nono dígito.
export function brazilianPhoneCandidates(value) {
  const phone = normalizePhoneForWhatsApp(value)
  if (!phone) return []
  if(!phone.startsWith('55'))return[phone]
  const local = phone.slice(4)
  const values = new Set([phone])
  if (local.length === 9 && local.startsWith('9')) values.add(`${phone.slice(0, 4)}${local.slice(1)}`)
  if (local.length === 8) values.add(`${phone.slice(0, 4)}9${local}`)
  return [...values]
}

export const phonesMatch = (left, right) => {
  const rightCandidates = new Set(brazilianPhoneCandidates(right))
  return brazilianPhoneCandidates(left).some((phone) => rightCandidates.has(phone))
}

// A consulta que fornece `members` já deve estar limitada à organização e a membros ativos.
// Centralizar a comparação aqui mantém o webhook genérico para qualquer integrante autorizado.
export const findInternalMemberByPhone = (members, phone) =>
  (Array.isArray(members) ? members : []).find((member) => phonesMatch(member?.phone, phone)) || null

const isoInSaoPaulo = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date)
const addDays = (iso, amount) => {
  const date = new Date(`${iso}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}
const weekdayIndex = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 }

export function resolveRelativeDate(value, now = new Date()) {
  const text = foldText(value)
  const today = isoInSaoPaulo(now)
  const numericDate = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\b/)
  if (numericDate) {
    const candidate = `${numericDate[3] || today.slice(0, 4)}-${numericDate[2].padStart(2, '0')}-${numericDate[1].padStart(2, '0')}`
    const parsed = new Date(`${candidate}T12:00:00Z`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate ? candidate : null
  }
  if (/depois de amanha/.test(text)) return addDays(today, 2)
  if (/\bamanha\b/.test(text)) return addDays(today, 1)
  if (/\bhoje\b/.test(text)) return today
  // "até o final do dia" / "até o fim do dia" / "fim do dia" / "no final do dia" — sem hora explícita,
  // sempre hoje (America/Sao_Paulo). Nunca inventa horário: due_time continua null em parseTaskSchedule.
  if (/\b(?:final|fim)\s+do\s+dia\b/.test(text)) return today
  if (/\bontem\b/.test(text)) return addDays(today, -1)
  const dayOnly = text.match(/^(?:dia\s+)?(\d{1,2})$/)
  if (dayOnly) {
    const candidate = `${today.slice(0, 8)}${String(Number(dayOnly[1])).padStart(2, '0')}`
    const parsed = new Date(`${candidate}T12:00:00Z`)
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate) return candidate
  }
  // "dia 5 de outubro" / "5 de outubro" — mês explícito por extenso, ano corrente (ou o próximo, se a
  // data já passou este ano) para nunca agendar sem querer no passado.
  const dayMonth = text.match(/\b(?:dia\s+)?(\d{1,2})\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/)
  if (dayMonth) {
    const monthIndex = ['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'].indexOf(dayMonth[2])
    const day = String(Number(dayMonth[1])).padStart(2, '0'), month = String(monthIndex + 1).padStart(2, '0')
    let candidate = `${today.slice(0, 4)}-${month}-${day}`
    if (candidate < today) candidate = `${Number(today.slice(0, 4)) + 1}-${month}-${day}`
    const parsed = new Date(`${candidate}T12:00:00Z`)
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate) return candidate
  }
  if (/fim da semana/.test(text)) {
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay()
    return addDays(today, (5 - weekday + 7) % 7 || 7)
  }
  if (/semana que vem/.test(text)) return addDays(today, 7)
  for (const [name, target] of Object.entries(weekdayIndex)) {
    if (new RegExp(`\\b${name}\\b`).test(text)) {
      const current = new Date(`${today}T12:00:00Z`).getUTCDay()
      return addDays(today, (target - current + 7) % 7 || 7)
    }
  }
  const explicit = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/)
  return explicit ? explicit[0] : null
}

export function parseTaskSchedule(value, now = new Date()) {
  const raw = clean(value)
  const match = raw.match(/(?:^|\s)(?:às?|as)\s*(\d{1,2})(?::(\d{2}))?(?:\s*(?:h|hrs?|horas?))?\b|\b(\d{1,2})(?::(\d{2}))?\s*(?:h|hrs?|horas?)\b|\b(\d{1,2}):(\d{2})\b/iu)
  if (!match) return { due_date: resolveRelativeDate(raw, now), due_time: null }
  const hour = Number(match[1] || match[3] || match[5]); const minute = Number(match[2] || match[4] || match[6] || 0)
  const dueTime = hour <= 23 && minute <= 59 ? `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` : null
  return { due_date: resolveRelativeDate(raw, now) || (dueTime ? isoInSaoPaulo(now) : null), due_time: dueTime }
}

function meetingCommand(raw, now) {
  const match = raw.match(/^\s*(reuni[aã]o|call|liga[cç][aã]o)\s+(?:com\s+)?(.+)$/iu)
  if (!match) return null
  const schedule = parseTaskSchedule(raw, now)
  const participant = trimEdges(match[2]
    .replace(/(?:^|\s)(?:às?|as)\s*\d{1,2}(?::\d{2})?(?:\s*(?:h|hrs?|horas?))?\b|\b\d{1,2}(?::\d{2})?\s*(?:h|hrs?|horas?)\b|\b\d{1,2}:\d{2}\b/giu, '')
    .replace(/(?:^|\s)(hoje|amanhã|depois de amanhã|segunda(?:-feira)?|terça(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sábado|domingo)(?=\s|$)/giu, ''))
  if (!participant && !schedule.due_date && !schedule.due_time) return null
  const kind = foldText(match[1]) === 'reuniao' ? 'Reunião' : foldText(match[1]) === 'call' ? 'Call' : 'Ligação'
  return {
    intent: 'CREATE_TASK', raw_text: raw, title: participant ? `${kind} com ${participant}` : kind,
    participant_name: participant || null, task_type: 'meeting', ...schedule,
    schedule_ambiguous: !schedule.due_date || !schedule.due_time,
    assignee_name: null, priority: 'medium', confidence: schedule.due_date && schedule.due_time ? .99 : .72,
  }
}

const shortId = (text) => text.match(/#([a-f0-9]{6})\b/i)?.[1]?.toUpperCase() || null
const priority = (text) => /prioridade (critica|urgente)/.test(text) ? 'critical'
  : /prioridade alta/.test(text) ? 'high'
    : /prioridade baixa/.test(text) ? 'low'
      : /prioridade media/.test(text) ? 'medium' : null
const after = (raw, expression) => clean(raw.match(expression)?.[1]) || null
const moneyAmount = (text) => { const value=text.match(/(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)/)?.[1];return value?Number(value.replace(/\./g,'').replace(',','.')):null }
// Remove o valor monetário (e uma preposição solta que sobrar antes dele) para isolar o nome do cliente.
const stripAmount = (raw) => raw.replace(/(?:r\$\s*)?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?\s*(?:reais?)?/gi, '').replace(/\s+(?:de|da|do)\s*$/i, '').trim()
// Artigo só é consumido como palavra inteira (com espaço depois) — senão "Origami" vira "rigami"
// quando o artigo opcional casa com o próprio "O" inicial do nome.
const ARTICLE = `(?:(?:a|o|os|as)\\s+)?`
// Lookbehind evita casar "ainda não pagou"/"nao pagou" como se fosse um recebimento confirmado.
const PAID_BY_PATTERN = new RegExp(`^${ARTICLE}([\\p{L}][\\p{L}\\s'-]*?)\\s+(?<!n[ãa]o )(?:pagou|pagaram)\\b`, 'iu')
const receiptParts = (raw, text) => {
  const paidBy = raw.match(PAID_BY_PATTERN)
  if (paidBy) return { amount: moneyAmount(text), subject_query: clean(paidBy[1]) }
  return { amount: moneyAmount(text), subject_query: after(stripAmount(raw), /(?:da|do|de)\s+(.+)$/iu) }
}
const proposalParts = (raw) => {
  const amount = moneyAmount(foldText(raw))
  const currency = /(?:€|\beur\b)/iu.test(raw) ? 'EUR' : 'BRL'
  const withoutLead = raw.replace(/^(?:anota(?:r)?\s+|fizemos\s+|mandamos\s+|enviamos\s+)?/iu, '')
  const clientThenService = withoutLead.match(/(?:proposta|orçamento|orcamento)\s+para\s+(.+?)\s+de\s+(?:r\$|€|eur)?\s*[\d.]+(?:,\d+)?\s+para\s+(?:o|a)?\s*(.+)$/iu)
  if(clientThenService)return{amount,currency,service:clean(clientThenService[2]),subject_query:clean(clientThenService[1])}
  const detailed = withoutLead.match(/(?:proposta|orçamento|orcamento)\s+de\s+(.+?)\s+(?:da|do|para)\s+(.+?)\s+(?:por|de)\s+(?:r\$|€|eur)?\s*[\d.]+(?:,\d+)?/iu)
  if (detailed) return { amount, currency, service: clean(detailed[1]), subject_query: clean(detailed[2]) }
  const priced = withoutLead.match(/(?:proposta|orçamento|orcamento)\s+de\s+(?:r\$|€|eur)?\s*[\d.]+(?:,\d+)?\s+para\s+(.+)$/iu)
  if (priced) return { amount, currency, service: null, subject_query: clean(priced[1]) }
  const simple = withoutLead.match(/(?:proposta|orçamento|orcamento)(?:\s+de\s+(.+?))?\s+para\s+(.+?)(?:\s+(?:por|de)\s+(?:r\$|€|eur)?\s*[\d.]+(?:,\d+)?)?$/iu)
  if(simple)return { amount, currency, service: clean(simple[1]) || null, subject_query: clean(simple[2]) || null }
  const unpriced=withoutLead.match(/(?:proposta|orçamento|orcamento)\s+para\s+(.+)$/iu)
  return { amount, currency, service: null, subject_query: clean(unpriced?.[1]) || null }
}

// Saudação pura (só "oi"/"bom dia"/etc., com ou sem "assistente" no final) nunca deve cair em HELP —
// HELP fica reservado para pedidos explícitos de ajuda (ver regex abaixo).
const GREETING_PATTERN = /^(oi+e?|ei|ola|bom dia|boa tarde|boa noite|e ai|eae|fala|salve)(\s+(assistente|mugo))?[\s!.,]*$/
const HELP_PATTERN = /^(menu|ajuda|help|comandos|o que (voce|vc) (faz|pode fazer)|como funciona|o que posso (pedir|te pedir))$/
// "quero registrar atividade" é uma intenção neutra — não presume início nem fim. A resposta pede o
// relato livre; a próxima mensagem (com verbo/particípio) resolve para ACTIVITY_START/COMPLETE.
const ACTIVITY_CAPTURE_PATTERN = /\b(?:quero|vou|preciso)\s+registrar\s+(?:uma\s+)?atividade\b|^registrar\s+(?:uma\s+)?atividade$|^anotar\s+atividade$/
const TASK_CREATE_LEAD_PATTERN = /^(?:(?:quero|preciso|gostaria\s+de|pode|por\s+favor)\s+)?(?:criar|cria|registrar|registre|adicionar|adicione|incluir|inclua)(?:\s+uma)?\s+tarefas?\b|^nova(?:\s+uma)?\s+tarefa\b/iu
const TASK_CREATE_COMMAND_ONLY_PATTERN = /^(?:(?:quero|preciso|gostaria\s+de|pode|por\s+favor)\s+)?(?:criar|cria|registrar|registre|adicionar|adicione|incluir|inclua)(?:\s+uma)?\s+tarefas?[\s.!?]*$|^nova(?:\s+uma)?\s+tarefa[\s.!?]*$/iu
export const isTaskCreationCommandOnly = (value) => TASK_CREATE_COMMAND_ONLY_PATTERN.test(clean(value))
// TAREFA (crm_tasks) só quando há um sinal explícito: a palavra "tarefa(s)" ou um short id. Sem isso,
// verbos de conclusão/início descrevem ATIVIDADE (operational_events) — o caso mais comum no dia a dia.
const TASK_SIGNAL = /\btarefas?\b/iu
// Verbos de conclusão em 1ª pessoa/infinitivo/imperativo — todos convergem para o mesmo tratamento;
// só o sinal de tarefa decide se vira COMPLETE_TASK ou ACTIVITY_COMPLETE.
// Aceita "finalizei X" normal, "finalizei" sozinho (sem objeto) e "finalizei:" como cabeçalho de
// lista multilinha.
const COMPLETION_LEAD = /^(?:terminei(?:\s+de)?|finaliz(?:ei|ar|a)|conclu(?:ir|[ií])|acabei\s+de)(?:\s+|\s*:?\s*$)/iu
// Particípio solto em qualquer posição: "finalizado X", "X finalizado", "x, finalizado".
const COMPLETION_WORD_SOURCE = '(?:finalizad[oa]s?|conclu[ií]d[oa]s?|pronta?s?|feita?s?|entregues?)'
const COMPLETION_WORD = new RegExp(`\\b${COMPLETION_WORD_SOURCE}\\b`, 'iu')
const START_LEAD = /^(?:comecei|iniciei|estou\s+come[cç]ando|estou\s+fazendo)(?:\s+|\s*:?[.!]?\s*$)/iu
const trimEdges = (value) => clean(value).replace(/\s{2,}/g, ' ').replace(/^[\s,.\-:]+|[\s,.\-:]+$/g, '')
const TASK_DATE_SUFFIX = /\s+(?:hoje|amanhã|depois\s+de\s+amanhã|segunda(?:-feira)?|terça(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sábado|domingo|fim\s+da\s+semana|semana\s+que\s+vem)\s*$/iu
const TASK_TIME_SUFFIX = /\s+(?:(?:às?|as)\s*\d{1,2}(?::\d{2})?(?:\s*(?:h|hrs?|horas?))?|\d{1,2}(?::\d{2}|\s*(?:h|hrs?|horas?)))\s*$/iu
const TASK_MONTH_DATE_SUFFIX = /\s+(?:dia\s+)?\d{1,2}\s+de\s+(?:janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s*$/iu
export function taskTitleFromText(value) {
  let title = clean(value)
  // Aceita tanto “amanhã às 14h” quanto “às 14h amanhã”, sem manter agenda no título.
  for (let index = 0; index < 2; index += 1) title = title.replace(TASK_DATE_SUFFIX, '').replace(TASK_TIME_SUFFIX, '').replace(TASK_MONTH_DATE_SUFFIX, '')
  return trimEdges(title)
}
// "ainda não está finalizado" não é conclusão real — "não" antes do particípio inverte o sentido.
const isNegatedCompletion = (text) => new RegExp(`\\bnao\\b[\\s\\S]*?\\b${COMPLETION_WORD_SOURCE}\\b`, 'u').test(text)
function completionSubject(raw, text) {
  const lead = raw.match(COMPLETION_LEAD)
  if (lead) return trimEdges(raw.slice(lead[0].length).replace(/^(?:hoje|ontem|dia\s+\d{1,2}|segunda|terça|quarta|quinta|sexta|sábado|domingo)\s+/iu,'')) || null
  if (COMPLETION_WORD.test(raw) && !isNegatedCompletion(text)) return trimEdges(raw.replace(COMPLETION_WORD, '')) || null
  return undefined
}
function startSubject(raw) {
  const lead = raw.match(START_LEAD)
  return lead ? (trimEdges(raw.slice(lead[0].length)) || null) : undefined
}
const stripTaskWords = (value) => trimEdges(clean(value).replace(/^(?:a\s+)?tarefas?\s*(?:de|do|da)?\s*/iu, ''))
// Palavras genéricas nunca viram nome de cliente — "cobrar clientes" é pedido de lista, não de um cliente chamado "clientes".
const GENERIC_COLLECTION_WORDS = new Set(['cliente', 'clientes', 'empresa', 'empresas', 'cobranca', 'cobrancas', 'pendencia', 'pendencias', 'devedor', 'devedores'])
// Palavras/expressões referenciais ("os dois", "o primeiro"...) são resolvidas contra a sessão no worker,
// não aqui no parser isolado — aqui só marcamos o texto puro para o worker reconhecer.
const stripGenericNoun = (value) => value.replace(/\s+(trabalhos?|tarefas?|atividades?|itens?)$/, '')
export const REFERENTIAL_ALL_WORDS = new Set(['os dois', 'as duas', 'ambos', 'ambas', 'todos', 'todas', 'eles', 'elas'])
export const REFERENTIAL_ORDINAL_MAP = { 'o primeiro': 0, 'a primeira': 0, primeiro: 0, primeira: 0, 'o segundo': 1, 'a segunda': 1, segundo: 1, segunda: 1 }
export const foldReferential = (value) => stripGenericNoun(foldText(value))

function parseSingle(rawInput, now) {
  const raw = clean(rawInput)
  const text = foldText(raw)
  const base = { raw_text: raw, due_date: resolveRelativeDate(raw, now) }
  if (!text) return { intent: 'UNKNOWN', confidence: 0 }
  if (GREETING_PATTERN.test(text)) return { ...base, intent: 'GREETING', confidence: 1 }
  if (HELP_PATTERN.test(text)) return { intent: 'HELP', confidence: 1 }
  const meeting = meetingCommand(raw, now)
  if (meeting) return meeting
  if (/^(sim|confirmo|pode registrar|confirmar)$/.test(text)) return { intent: 'CONFIRM_FINANCIAL', confidence: 1 }
  if (/^(nao|cancelar|cancela|nao registrar|deixa|esquece|nao precisa)$/.test(text)) return { intent: 'CANCEL_FINANCIAL', confidence: 1 }
  if (/^recebi\s+(?:o\s+)?(?:comprovante|anexo|arquivo|documento)\b/.test(text)) { const subject=after(stripAmount(raw), /(?:da|do|de)\s+(.+)$/iu); return{...base,intent:'DOCUMENT',subject_query:subject,summary:raw,confidence:.85} }
  if (/^(recebi|entrou|recebemos|caiu)\b/.test(text) && /\bfreela(?:nce)?\b/.test(text)) { const amount=moneyAmount(text),project=after(raw, /(?:freela(?:nce)?\s+(?:da|do|de)|freela(?:nce)?\s+)(.+)$/iu);return{...base,intent:'FREELANCE_INCOME_REQUEST',amount,project_source:project||'Freela',confidence:amount?.toString()?0.98:0.55} }
  if (/^(recebi|entrou|recebemos|caiu)\b/.test(text)) { const {amount,subject_query}=receiptParts(raw,text);return{...base,intent:'FINANCIAL_RECEIPT_REQUEST',amount,subject_query,confidence:amount?.toString()&&subject_query?0.96:0.6} }
  if(PAID_BY_PATTERN.test(raw)){const {amount,subject_query}=receiptParts(raw,text);return{...base,intent:'FINANCIAL_RECEIPT_REQUEST',amount,subject_query,confidence:amount?.toString()&&subject_query?0.96:0.6}}
  if (/^(gastei|paguei|despesa de)\b/.test(text)) { const amount=moneyAmount(text),category=after(raw, /(?:em|com)\s+(.+)$/iu);return { ...base,intent:'FINANCIAL_EXPENSE_REQUEST',amount,category_name:category,description:category,confidence:amount?.toString()?0.98:0.55 } }
  const proposalUpdate=raw.match(/^(.+?)\s+(aceitou|aprovou|recusou|rejeitou|visualizou)\s+(?:o\s+|a\s+)?(?:orçamento|orcamento|proposta)\b/iu)
  if(proposalUpdate){const action=foldText(proposalUpdate[2]),status=/aceitou|aprovou/.test(action)?'accepted':/recusou|rejeitou/.test(action)?'rejected':'viewed';return{...base,intent:'UPDATE_PROPOSAL',subject_query:clean(proposalUpdate[1]),proposal_status:status,confidence:.98}}
  if(/\b(proposta|orçamento|orcamento)\b/.test(text)){const parts=proposalParts(raw),proposal_status=/\b(mandamos|enviamos)\b/.test(text)?'sent':'draft';return{...base,intent:'RECORD_PROPOSAL',...parts,proposal_status,confidence:parts.subject_query&&parts.amount?0.98:.62}}
  const hours=text.match(/(?:trabalhei|foram|coloca|fecha (?:o|meu) dia (?:com)?)\s*(\d+(?:[.,]\d+)?)\s*h(?:oras?)?\b/)?.[1]
  if(hours)return{...base,intent:'RECORD_TIME',hours:Number(hours.replace(',','.')),summary:raw,confidence:.98}
  // Prefixo explícito ("anota que...") sem orçamento/proposta é sempre observação — precisa vir
  // antes dos padrões de cobrança/cliente abaixo, senão "anota que X pediu Y" viraria CLIENT_UPDATE.
  if(/^(anota|anote|observacao|obs:)\b/.test(text))return{...base,intent:'RECORD_OBSERVATION',summary:after(raw,/^(?:anota|anote|observação|observacao|obs:)\s*(.+)$/iu),confidence:.9}
  const notPaid = raw.match(new RegExp(`^${ARTICLE}([\\p{L}][\\p{L}\\s'-]*?)\\s+(?:ainda não pagou|não pagou ainda|nao pagou)\\b`, 'iu'))
  if(notPaid)return{...base,intent:'COLLECTION_ACTIVITY',collection_kind:'unpaid_status',subject_query:clean(notPaid[1]),summary:raw,confidence:.9}
  const promised = raw.match(new RegExp(`^${ARTICLE}([\\p{L}][\\p{L}\\s'-]*?)\\s+disse que paga\\b`, 'iu'))
  if(promised)return{...base,intent:'COLLECTION_ACTIVITY',collection_kind:'promised',subject_query:clean(promised[1]),summary:raw,confidence:.9}
  if(/^cobrei\b/.test(text)){const namePart=raw.replace(new RegExp(`^cobrei\\s+${ARTICLE}`,'iu'),'').split(/\s+porque\b/i)[0];return{...base,intent:'COLLECTION_ACTIVITY',collection_kind:'contacted',subject_query:clean(namePart),summary:raw,confidence:.93}}
  if(/^cobrar\b/.test(text)){
    const namePart=clean(clean(raw.replace(/^cobrar\s*/iu,'')).replace(new RegExp(`^${ARTICLE}`,'iu'),''))
    const foldedName=foldText(namePart).replace(/[.?!]+$/,'')
    if(!namePart||GENERIC_COLLECTION_WORDS.has(foldedName))return{...base,intent:'LIST_PENDING_CHARGES',confidence:.95}
    return{...base,intent:'COLLECTION_SEND',subject_query:namePart,confidence:.98}
  }
  const reminder = raw.match(new RegExp(`^me\\s+lembr[ae]?\\s+de\\s+cobrar\\s+${ARTICLE}(.+)$`, 'iu'))
  if(reminder){let subject=reminder[1];for(const word of['hoje','amanhã','depois de amanhã','segunda','terça','quarta','quinta','sexta','sábado','domingo','fim da semana','semana que vem'])subject=subject.replace(new RegExp(`\\s+${word}$`,'iu'),'');return{...base,intent:'FOLLOW_UP',subject_query:clean(subject),confidence:.95}}
  // Relato espontâneo de trabalho concluído. Orações independentes ligadas por “e” viram itens;
  // uma continuação após vírgula permanece junto do trabalho anterior para preservar o sentido.
  if (/^(?:hoje\s+)?(?:j[áa]\s+)?(?:eu\s+)?(?:fiz|produzi|preparei|enviei|mandei|entreguei)\b/iu.test(raw)) {
    const sentences = raw.split(/[.!?]+/).map(trimEdges).filter(Boolean)
    const fragments = sentences.flatMap((sentence) => sentence.split(/\s+e\s+(?=(?:fiz|produzi|preparei|enviei|mandei|entreguei)\b)/iu)).map(trimEdges).filter(Boolean)
    const items = fragments.map((fragment) => ({ summary: trimEdges(fragment.replace(/^(?:hoje\s+)?(?:j[áa]\s+)?(?:eu\s+)?(?:fiz|produzi|preparei|entreguei)\s+/iu, '')) })).filter((item) => item.summary)
    if (items.length) return { ...base, intent: 'ACTIVITY_COMPLETE', summary: items[0].summary, items, confidence: .94 }
  }
  // "trabalhei em/na/no X" (sem horas — isso já foi tratado acima) registra a atividade como feita.
  const worked = raw.match(/^trabalhei\s+(?:em|nas?|nos?)\s+(.+)$/iu)
  if(worked)return{...base,intent:'ACTIVITY_COMPLETE',summary:trimEdges(worked[1]),confidence:.9}
  const operationalStatus = [
    [/(?:^|\s+)aguardando\s+aprova[cç][aã]o\s*$/iu, 'waiting_approval'],
    [/(?:^|\s+)aguardando\s+(?:o\s+)?cliente\s*$/iu, 'waiting_client'],
    [/(?:^|\s+)(?:aguardando|esperando)\s+material\s*$/iu, 'waiting_material'],
    [/(?:^|\s+)bloquead[oa]\s*$/iu, 'blocked'],
  ].find(([pattern]) => pattern.test(raw))
  if (operationalStatus) return {
    intent: 'UPDATE_TASK_STATUS',
    task_query: trimEdges(raw.replace(operationalStatus[0], '')),
    task_status: operationalStatus[1], confidence: .98,
  }
  const hasTaskSignal = TASK_SIGNAL.test(text) || Boolean(shortId(text))
  const cancelled = raw.match(/^(?:cancelei|cancelamos)(?:\s+|\s*:?[.!]?\s*$)(.*)$/iu)
  if (cancelled) {
    const short = shortId(text)
    const query = short ? null : (stripTaskWords(cancelled[1] || '') || null)
    return { intent: 'CANCEL_TASK', task_short_id: short, task_query: query, confidence: short ? 1 : (query ? .9 : .7) }
  }
  const completion = completionSubject(raw, text)
  if (completion !== undefined) {
    if (hasTaskSignal) {
      const short = shortId(text)
      const query = short ? null : (stripTaskWords(completion || '') || null)
      return { intent: 'COMPLETE_TASK', task_short_id: short, task_query: query, confidence: short ? 1 : (query ? .85 : .5) }
    }
    return { ...base, intent: 'ACTIVITY_COMPLETE', summary: completion, confidence: .95 }
  }
  const starting = startSubject(raw)
  if (starting !== undefined) {
    if (hasTaskSignal) {
      const short = shortId(text)
      const query = short ? null : (stripTaskWords(starting || '') || null)
      return { intent: 'START_TASK', task_short_id: short, task_query: query, confidence: short ? 1 : (query ? .85 : .5) }
    }
    return { ...base, intent: 'ACTIVITY_START', summary: starting, confidence: .95 }
  }
  if (ACTIVITY_CAPTURE_PATTERN.test(text)) return { intent: 'ACTIVITY_CAPTURE', confidence: .9 }
  const clientRequest = raw.match(new RegExp(`^${ARTICLE}([\\p{L}][\\p{L}\\s'-]*?)\\s+pediu\\s+(.+)$`, 'iu'))
  if(clientRequest)return{...base,intent:'CLIENT_UPDATE',subject_query:clean(clientRequest[1]),summary:clean(clientRequest[2]),confidence:.9}
  if(/\b(aprovou|reprovou|decidiu|autorizou)\b/.test(text))return{...base,intent:'RECORD_DECISION',summary:raw,confidence:.93}
  if (/\b(o que|oq|que)\s+(eu\s+)?fiz\s+hoje\b/.test(text)) return { ...base, intent: 'DAY_SUMMARY', confidence: 1 }
  if (/(o que|oq|que).*tenho hoje|meu dia|minhas tarefas( hoje)?/.test(text)) return { ...base, intent: 'LIST_MINE', confidence: 1 }
  const memberToday = raw.match(new RegExp(`(?:o que|oq|que)\\s+${ARTICLE}([\\p{L}'-]+)\\s+tem\\s+hoje`, 'iu'))
  if (memberToday) return { ...base, intent: 'LIST_TEAM', assignee_name: memberToday[1], confidence: 1 }
  if (/(?:tarefas?.*)?atrasad[oa]s?|o que esta atrasado|esta atrasado/.test(text)) return { ...base, intent: 'LIST_OVERDUE', confidence: 1 }
  if (/como esta a equipe|tarefas? da equipe|equipe hoje/.test(text)) return { ...base, intent: 'LIST_TEAM', confidence: 1 }
  if (/tarefas?.*hoje|o que temos hoje/.test(text)) return { ...base, intent: 'LIST_TODAY', confidence: 1 }
  if (/alguem.*(esperando|aguardando).*atendimento|atendimentos? esperando/.test(text)) return { intent: 'LIST_WAITING_ATTENDANCE', confidence: 1 }
  if (/quem (?:esta|ta) atendendo\b/.test(text)) return { intent: 'LIST_WAITING_ATTENDANCE', subject_query: after(raw, /quem (?:está|esta|tá|ta) atendendo\s+(.+)$/iu), confidence: 1 }
  if (/quem esta devendo|quem deve\b/.test(text)) return { ...base, intent: 'QUERY_OVERDUE_RECEIVABLES', confidence: 1 }
  if (/cobrancas?.*(pendentes?|vencid)|tem cobranca/.test(text)) return { intent: 'LIST_PENDING_CHARGES', confidence: 1 }
  if (/quanto entrou (hoje|esse mes|este mes|no mes)?/.test(text) && /entrou/.test(text)) return { ...base, intent: 'QUERY_RECEIVED_TOTAL', period: /hoje/.test(text) ? 'today' : 'month', confidence: 1 }
  const monthMentioned = ['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'].find((name) => text.includes(name))
  if (/quais? despesas?/.test(text)) return { ...base, intent: 'QUERY_EXPENSES', month_name: monthMentioned || null, confidence: 1 }
  if (/(alguma|tem).*confirmacao pendente|confirmacoes? pendentes?/.test(text)) return { ...base, intent: 'QUERY_PENDING_CONFIRMATIONS', confidence: 1 }
  if (/quantas horas.*(essa semana|esta semana|na semana)/.test(text)) return { ...base, intent: 'QUERY_WEEKLY_HOURS', confidence: 1 }
  if (/^(iniciar|inicia|comecar|comeca)\b/.test(text)) {
    const short = shortId(text)
    const query = short ? null : (stripTaskWords(after(raw, /^(?:iniciar|inicia|come[cç]ar|come[cç]a)\s+(.+)$/iu) || '') || null)
    return { intent: 'START_TASK', task_short_id: short, task_query: query, confidence: short ? 1 : (query ? .85 : .5) }
  }
  if (/^(mover|move|passa)\b/.test(text) && base.due_date) return { ...base, intent: 'MOVE_TASK', task_short_id: shortId(text), task_query: shortId(text) ? null : after(raw, /^(?:mover|move|passa)\s+(.+?)\s+(?:para|pra)\s+/i), confidence: .9 }
  if (/^(atribuir|atribui)\b/.test(text)) return { intent: text.includes('tarefa') || shortId(text) ? 'ASSIGN_TASK' : 'ASSIGN_CONVERSATION', task_short_id: shortId(text), subject_query: after(raw, /^(?:atribuir|atribui)\s+(.+?)\s+(?:para|pra)\s+/i), assignee_name: after(raw, /\s(?:para|pra)\s+([\p{L} .'-]+)$/iu), confidence: .9 }
  if (/^(assumir|assume)\b/.test(text)) return { intent: 'TAKE_CONVERSATION', subject_query: after(raw, /^(?:assumir|assume)\s+(.+)$/i), confidence: .9 }
  if (/^pausa(?:r)? (?:o )?bot/.test(text)) return { intent: 'PAUSE_AUTOMATION', subject_query: after(raw, /^pausa(?:r)? (?:o )?bot (?:do|da|de) (.+)$/i), confidence: .9 }
  if (/^retoma(?:r)? (?:o )?bot/.test(text)) return { intent: 'RESUME_AUTOMATION', subject_query: after(raw, /^retoma(?:r)? (?:o )?bot (?:do|da|de) (.+)$/i), confidence: .9 }
  if (/prioridade (baixa|media|alta|critica|urgente)/.test(text)) return { intent: 'SET_PRIORITY', task_short_id: shortId(text), task_query: shortId(text) ? null : after(raw, /^(?:coloca|defina|define)?\s*(.+?)\s+(?:como|com) prioridade/i), priority: priority(text), confidence: .9 }
  const taskByDate=raw.match(/^(?:criar|cria|nova)(?:\s+uma)?\s+tarefas?\s+para\s+(hoje|amanhã|depois de amanhã|segunda|terça|quarta|quinta|sexta|sábado|domingo|fim da semana|semana que vem)\s+(.+)$/iu)
  if(taskByDate)return{...base,intent:'CREATE_TASK',title:clean(taskByDate[2]),assignee_name:null,priority:priority(text)||'medium',confidence:.98}
  const delegated=raw.match(/^([\p{L}'-]+)\s+precisa\s+(.+)$/iu)
  if(delegated){const title=delegated[2].replace(/\s+(hoje|amanhã|depois de amanhã|segunda|terça|quarta|quinta|sexta|sábado|domingo|fim da semana|semana que vem)$/iu,'');return{...base,intent:'CREATE_TASK',title:clean(title),assignee_name:delegated[1],priority:priority(text)||'medium',confidence:base.due_date?.length?0.98:0.9}}
  // Pedidos de criação sem conteúdo são intenção, nunca título. O mesmo caminho aceita conteúdo
  // explícito depois do comando, sem depender de IA nem de um telefone específico.
  if (TASK_CREATE_LEAD_PATTERN.test(raw)) {
    const assignee = raw.match(/\bpara\s+([\p{L}'-]+)(?:\s+.+)?$/iu)?.[1] || null
    const dateWord = /(hoje|amanhã|depois de amanhã|segunda|terça|quarta|quinta|sexta|sábado|domingo|fim da semana|semana que vem)/iu
    let title = clean(raw.replace(TASK_CREATE_LEAD_PATTERN, ''))
      .replace(new RegExp(`^${dateWord.source}\\s+`, 'iu'), '')
      .replace(new RegExp(`\\s+${dateWord.source}(?=\\s|$).*$`, 'iu'), '')
    if (assignee) title = title.replace(new RegExp(`^para\\s+${assignee}\\s+`, 'iu'), '').replace(new RegExp(`\\s+para\\s+${assignee}$`, 'iu'), '')
    title = taskTitleFromText(title)
    return { ...base, intent: 'CREATE_TASK', title: clean(title), assignee_name: assignee, priority: priority(text) || 'medium', confidence: title ? .95 : .6 }
  }
  return { intent: 'UNKNOWN', confidence: 0, raw_text: raw }
}

// Mensagens com várias linhas registram vários itens em um só envio: a primeira linha define a
// intenção (ex.: "finalizei o site de mila" ou "criar tarefas:"), e linhas seguintes sem verbo próprio
// herdam essa intenção como itens adicionais — nunca vira um único evento/tarefa com descrição
// genérica tipo "os dois trabalhos".
const ACTIVITY_INTENTS = new Set(['ACTIVITY_START', 'ACTIVITY_COMPLETE'])
// Lista numerada inline ("1. item 2. item 3. item" ou "1) item 2) item 3) item") só conta como lista
// quando há pelo menos 2 marcadores SEQUENCIAIS começando em 1 — evita quebrar números comuns, valores
// monetários, datas ou versões ("campanha 2026", "R$ 3.500", "versão 2.0") e frases como "terminamos a
// etapa 4. Começamos a etapa 5" (marcadores existem mas não são sequenciais a partir de 1).
const INLINE_LIST_MARKER = /(?:^|\s)(\d{1,2})[.)]\s+(?=\S)/g
export function splitInlineNumberedList(value) {
  const text = clean(value)
  const markers = [...text.matchAll(INLINE_LIST_MARKER)]
  if (markers.length < 2) return null
  const numbers = markers.map((match) => Number(match[1]))
  const sequential = numbers[0] === 1 && numbers.every((number, index) => index === 0 || number === numbers[index - 1] + 1)
  if (!sequential) return null
  const header = trimEdges(text.slice(0, markers[0].index))
  const items = markers.map((match, index) => {
    const start = match.index + match[0].length
    const end = index + 1 < markers.length ? markers[index + 1].index : text.length
    return trimEdges(text.slice(start, end))
  }).filter(Boolean)
  return items.length >= 2 ? { header, items } : null
}
export function parseInternalCommand(rawText, { now = new Date() } = {}) {
  const raw = clean(rawText)
  let lines = raw.split(/\r?\n/).flatMap((line) => line.split(/\s*[•;]\s*/)).map((line) => clean(line.replace(/^[-*]\s+/, ''))).filter(Boolean)
  if (lines.length <= 1) {
    // Sem newline/bullet/";" — ainda pode ser uma lista numerada na mesma linha. Quando for, ela se
    // comporta exatamente como uma lista multilinha (cabeçalho opcional + itens) daqui em diante.
    const inline = splitInlineNumberedList(raw)
    if (!inline) return parseSingle(raw, now)
    lines = inline.header ? [inline.header, ...inline.items] : inline.items
  }
  const first = parseSingle(lines[0], now)

  if (ACTIVITY_INTENTS.has(first.intent)) {
    // "finalizei:" sozinho é só um cabeçalho (summary vazio) — cada linha seguinte é um item próprio.
    const headerOnly = !clean(first.summary)
    const items = headerOnly ? [] : [{ summary: clean(first.summary) }]
    for (const line of lines.slice(1)) {
      const parsedLine = parseSingle(line, now)
      const inherited = parsedLine.intent === first.intent && clean(parsedLine.summary) ? parsedLine.summary : (parsedLine.intent === 'UNKNOWN' ? line : null)
      if (inherited) items.push({ summary: clean(inherited) })
    }
    if (items.length > (headerOnly ? 0 : 1)) return { ...first, items, summary: items[0].summary, confidence: Math.max(first.confidence, .9) }
  }

  if (first.intent === 'CREATE_TASK') {
    // "criar tarefas:" sozinho é só um cabeçalho (title vazio) — cada linha seguinte é uma tarefa própria.
    const headerOnly = !clean(first.title)
    const items = headerOnly ? [] : [{ title: clean(first.title), due_date: first.due_date, due_time: first.due_time || null, task_type: first.task_type || 'general', participant_name: first.participant_name || null }]
    for (const line of lines.slice(1)) {
      const parsedLine = parseSingle(line, now)
      const title = parsedLine.intent === 'CREATE_TASK' && clean(parsedLine.title) ? parsedLine.title : (parsedLine.intent === 'UNKNOWN' ? line : null)
      if (title) items.push({ title: taskTitleFromText(title), ...parseTaskSchedule(line, now), task_type: parsedLine.task_type || 'general', participant_name: parsedLine.participant_name || null })
    }
    if (items.length > (headerOnly ? 0 : 1)) return { ...first, items, title: items[0].title, due_date: items[0].due_date, confidence: Math.max(first.confidence, .9) }
  }

  // Uma lista pura, sem cabeçalho, também representa várias tarefas. Exigimos que todas as linhas
  // sejam texto livre para não converter acidentalmente uma conversa com outro comando reconhecido.
  const parsedLines = lines.map((line) => parseSingle(line, now))
  if (parsedLines.every((item) => item.intent === 'UNKNOWN')) {
    const items = lines.map((line) => ({ title: taskTitleFromText(line), ...parseTaskSchedule(line, now), task_type: 'general', participant_name: null }))
    return { intent: 'CREATE_TASK', raw_text: raw, title: items[0].title, due_date: items[0].due_date, due_time: items[0].due_time, items, assignee_name: null, priority: 'medium', confidence: .9 }
  }

  return parseSingle(raw, now)
}

export const taskShortId = (id) => `#${clean(id).replace(/-/g, '').slice(0, 6).toUpperCase()}`

export const HELP_TEXT = `Você pode me pedir para:\n\n• criar tarefas\n• registrar atividades\n• registrar horas\n• anotar decisões\n• registrar despesas\n• registrar recebimentos\n• cobrar clientes\n• consultar seu dia\n• consultar pendências`
