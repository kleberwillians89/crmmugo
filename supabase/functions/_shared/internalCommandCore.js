const clean = (value) => String(value ?? '').trim()
export const foldText = (value) => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ')

export function normalizeBrazilianPhone(value) {
  let phone = clean(value).replace(/\D/g, '')
  if (phone.startsWith('00')) phone = phone.slice(2)
  if (!phone.startsWith('55') && /^\d{10,11}$/.test(phone)) phone = `55${phone}`
  return /^55[1-9]{2}\d{8,9}$/.test(phone) ? phone : ''
}

// WhatsApp pode entregar números brasileiros antigos sem o nono dígito.
export function brazilianPhoneCandidates(value) {
  const phone = normalizeBrazilianPhone(value)
  if (!phone) return []
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
  if (/depois de amanha/.test(text)) return addDays(today, 2)
  if (/\bamanha\b/.test(text)) return addDays(today, 1)
  if (/\bhoje\b/.test(text)) return today
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

const shortId = (text) => text.match(/#([a-f0-9]{6})\b/i)?.[1]?.toUpperCase() || null
const priority = (text) => /prioridade (critica|urgente)/.test(text) ? 'critical'
  : /prioridade alta/.test(text) ? 'high'
    : /prioridade baixa/.test(text) ? 'low'
      : /prioridade media/.test(text) ? 'medium' : null
const after = (raw, expression) => clean(raw.match(expression)?.[1]) || null
const moneyAmount = (text) => { const value=text.match(/(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)/)?.[1];return value?Number(value.replace(/\./g,'').replace(',','.')):null }

export function parseInternalCommand(rawText, { now = new Date() } = {}) {
  const raw = clean(rawText)
  const text = foldText(raw)
  const base = { raw_text: raw, due_date: resolveRelativeDate(raw, now) }
  if (!text) return { intent: 'UNKNOWN', confidence: 0 }
  if (/^(menu|ajuda|help|comandos)$/.test(text)) return { intent: 'HELP', confidence: 1 }
  if (/^(sim|confirmo|pode registrar|confirmar)$/.test(text)) return { intent: 'CONFIRM_FINANCIAL', confidence: 1 }
  if (/^(nao|cancelar|cancela|nao registrar)$/.test(text)) return { intent: 'CANCEL_FINANCIAL', confidence: 1 }
  if (/^(recebi|entrou)\b/.test(text) && /\bfreela(?:nce)?\b/.test(text)) { const amount=moneyAmount(text),project=after(raw, /(?:freela(?:nce)?\s+(?:da|do|de)|freela(?:nce)?\s+)(.+)$/iu);return{...base,intent:'FREELANCE_INCOME_REQUEST',amount,project_source:project||'Freela',confidence:amount?.toString()?0.98:0.55} }
  if (/^(recebi|entrou)\b/.test(text)) { const amount=moneyAmount(text),subject=after(raw, /(?:da|do|de)\s+(.+)$/iu);return{...base,intent:'FINANCIAL_RECEIPT_REQUEST',amount,subject_query:subject,confidence:amount?.toString()&&subject?0.96:0.6} }
  if (/^(gastei|paguei|despesa de)\b/.test(text)) { const amount=moneyAmount(text),category=after(raw, /(?:em|com)\s+(.+)$/iu);return { ...base,intent:'FINANCIAL_EXPENSE_REQUEST',amount,category_name:category,description:category||'Despesa informada pelo WhatsApp',confidence:amount?.toString()?0.98:0.55 } }
  const hours=text.match(/(?:trabalhei|foram)\s+(\d+(?:[.,]\d+)?)\s*horas?/)?.[1]
  if(hours)return{...base,intent:'RECORD_TIME',hours:Number(hours.replace(',','.')),summary:raw,confidence:.98}
  if(/^(comecei|iniciei|estou comecando)\b/.test(text))return{...base,intent:'ACTIVITY_START',summary:after(raw,/^(?:comecei|iniciei|estou começando)\s+(.+)$/iu),confidence:.95}
  if(/^(terminei|finalizei|conclui os?|conclui as?)\b/.test(text))return{...base,intent:'ACTIVITY_COMPLETE',summary:after(raw,/^(?:terminei|finalizei|concluí|conclui)\s+(.+)$/iu),confidence:.95}
  if(/\b(aprovou|reprovou|decidiu|autorizou)\b/.test(text))return{...base,intent:'RECORD_DECISION',summary:raw,confidence:.93}
  if(/^(anota|anote|observacao|obs:)\b/.test(text))return{...base,intent:'RECORD_OBSERVATION',summary:after(raw,/^(?:anota|anote|observação|observacao|obs:)\s*(.+)$/iu),confidence:.9}
  if (/(o que|oq|que).*tenho hoje|meu dia|minhas tarefas( hoje)?/.test(text)) return { ...base, intent: 'LIST_MINE', confidence: 1 }
  const memberToday = raw.match(/(?:o que|oq|que)\s+(?:a|o)?\s*([\p{L}'-]+)\s+tem\s+hoje/iu)
  if (memberToday) return { ...base, intent: 'LIST_TEAM', assignee_name: memberToday[1], confidence: 1 }
  if (/tarefas?.*atrasad|atrasadas?/.test(text)) return { ...base, intent: 'LIST_OVERDUE', confidence: 1 }
  if (/como esta a equipe|tarefas? da equipe|equipe hoje/.test(text)) return { ...base, intent: 'LIST_TEAM', confidence: 1 }
  if (/tarefas?.*hoje|o que temos hoje/.test(text)) return { ...base, intent: 'LIST_TODAY', confidence: 1 }
  if (/alguem.*(esperando|aguardando).*atendimento|atendimentos? esperando/.test(text)) return { intent: 'LIST_WAITING_ATTENDANCE', confidence: 1 }
  if (/quem (?:esta|ta) atendendo\b/.test(text)) return { intent: 'LIST_WAITING_ATTENDANCE', subject_query: after(raw, /quem (?:está|esta|tá|ta) atendendo\s+(.+)$/iu), confidence: 1 }
  if (/cobrancas?.*(pendentes?|vencid)|tem cobranca/.test(text)) return { intent: 'LIST_PENDING_CHARGES', confidence: 1 }
  if (/^(concluir|conclui|finalizar|finaliza)\b/.test(text)) return { intent: 'COMPLETE_TASK', task_short_id: shortId(text), confidence: shortId(text) ? 1 : .7 }
  if (/^(iniciar|inicia|comecar|comeca)\b/.test(text)) return { intent: 'START_TASK', task_short_id: shortId(text), confidence: shortId(text) ? 1 : .7 }
  if (/^(mover|move|passa)\b/.test(text) && base.due_date) return { ...base, intent: 'MOVE_TASK', task_short_id: shortId(text), task_query: shortId(text) ? null : after(raw, /^(?:mover|move|passa)\s+(.+?)\s+(?:para|pra)\s+/i), confidence: .9 }
  if (/^(atribuir|atribui)\b/.test(text)) return { intent: text.includes('tarefa') || shortId(text) ? 'ASSIGN_TASK' : 'ASSIGN_CONVERSATION', task_short_id: shortId(text), subject_query: after(raw, /^(?:atribuir|atribui)\s+(.+?)\s+(?:para|pra)\s+/i), assignee_name: after(raw, /\s(?:para|pra)\s+([\p{L} .'-]+)$/iu), confidence: .9 }
  if (/^(assumir|assume)\b/.test(text)) return { intent: 'TAKE_CONVERSATION', subject_query: after(raw, /^(?:assumir|assume)\s+(.+)$/i), confidence: .9 }
  if (/^pausa(?:r)? (?:o )?bot/.test(text)) return { intent: 'PAUSE_AUTOMATION', subject_query: after(raw, /^pausa(?:r)? (?:o )?bot (?:do|da|de) (.+)$/i), confidence: .9 }
  if (/^retoma(?:r)? (?:o )?bot/.test(text)) return { intent: 'RESUME_AUTOMATION', subject_query: after(raw, /^retoma(?:r)? (?:o )?bot (?:do|da|de) (.+)$/i), confidence: .9 }
  if (/prioridade (baixa|media|alta|critica|urgente)/.test(text)) return { intent: 'SET_PRIORITY', task_short_id: shortId(text), task_query: shortId(text) ? null : after(raw, /^(?:coloca|defina|define)?\s*(.+?)\s+(?:como|com) prioridade/i), priority: priority(text), confidence: .9 }
  if (/^(criar|cria|nova) tarefa\b/.test(text)) {
    const assignee = raw.match(/\bpara\s+([\p{L}'-]+)(?:\s+.+)?$/iu)?.[1] || null
    let title = raw.replace(/^(criar|cria|nova) tarefa\s*/i, '').replace(/\s+(hoje|amanhã|depois de amanhã|segunda|terça|quarta|quinta|sexta|sábado|domingo|fim da semana|semana que vem)(?=\s|$).*$/iu, '')
    if (assignee) title = title.replace(new RegExp(`^para\\s+${assignee}\\s+`, 'iu'), '').replace(new RegExp(`\\s+para\\s+${assignee}$`, 'iu'), '')
    return { ...base, intent: 'CREATE_TASK', title: clean(title), assignee_name: assignee, priority: priority(text) || 'medium', confidence: title ? .95 : .6 }
  }
  return { intent: 'UNKNOWN', confidence: 0, raw_text: raw }
}

export const taskShortId = (id) => `#${clean(id).replace(/-/g, '').slice(0, 6).toUpperCase()}`

export const HELP_TEXT = `MUGÔ — CENTRAL OPERACIONAL\n\n• meu dia\n• tarefas atrasadas\n• equipe hoje\n• comecei [atividade]\n• terminei [atividade]\n• trabalhei 2 horas hoje\n• [cliente] aprovou [decisão]\n• cria tarefa para [pessoa] ... amanhã\n• conclui #A1B2C3\n• gastei R$ 100 em [categoria] (exige confirmação)`
