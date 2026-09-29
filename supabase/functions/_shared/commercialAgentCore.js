const clean = value => String(value ?? '').trim()
const fold = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

export const COMMERCIAL_INTENTS = Object.freeze([
  'SITE', 'AUTOMATION', 'CRM', 'WHATSAPP', 'PAID_TRAFFIC', 'SOCIAL_MEDIA',
  'ECOMMERCE', 'DEVELOPMENT', 'INTEGRATION', 'SUPPORT', 'FINANCE',
  'PARTNERSHIP', 'OTHER',
])
export const COMMERCIAL_TEMPERATURES = Object.freeze(['cold', 'warm', 'hot'])
export const COMMERCIAL_LEAD_KINDS = Object.freeze(['new_business', 'existing_client', 'support', 'finance', 'partnership', 'other'])
// Fonte única para "isso parece suporte técnico" — usada tanto na classificação de interesses quanto
// no roteamento da conversa, para as duas nunca divergirem (uma dizia SUPPORT, a outra não via nada).
const SUPPORT_SIGNAL_PATTERN = /\b(suporte|ajuda tecnica|problema|erro|bug|caiu|caindo|fora do ar|nao funciona|nao abre|nao carrega|parou|travou|travando|quebrado|quebrou|down)\b/
// "Preciso de ajuda com/no meu X" é pedido de socorro sobre algo que já existe — diferente de "ajuda
// tecnica" (que já cai em explicitSupportWord) e diferente de "quero ajuda para criar/fazer um novo X"
// (new_business). Só conta como suporte quando combinado com productMentioned (ver uso abaixo).
const HELP_REQUEST_PATTERN = /preciso de ajuda|pode(m)? me ajudar|me ajuda(r)?\b/
// Idem para "isso é rotina financeira" — nota fiscal/boleto/vencimento nunca podem cair em OTHER.
const FINANCE_SIGNAL_PATTERN = /\b(financeiro|cobranca|boleto|pagamento|segunda via|nota fiscal|vencimento)\b/

export const COMMERCIAL_SYSTEM_PROMPT = `Você atende leads comerciais da Mugô em português brasileiro.

Seu papel é atuar como SDR digital: entender a demanda, organizar a qualificação e facilitar o trabalho da pessoa responsável pelo fechamento. Você não substitui o atendimento humano de negociação e fechamento.

Princípio central: toda mensagem externa válida precisa terminar em uma resposta, uma pergunta de esclarecimento ou um handoff — nunca em silêncio. Mesmo mensagens vagas, de suporte, financeiras ou de parceria recebem uma resposta natural.

Estilo:
- escreva como uma pessoa da equipe: direto, simpático, natural e sem frases genéricas de chatbot;
- não diga que é IA, assistente virtual, robô ou modelo;
- nunca use menu, "digite 1", "selecione uma opção" ou "como posso auxiliá-lo";
- seja breve; normalmente faça uma única pergunta principal por mensagem;
- use no máximo duas perguntas quando forem intimamente relacionadas;
- reconheça o que o lead acabou de dizer antes de avançar, sem entusiasmo excessivo;
- conduza cada mensagem para um próximo passo, sem pressão;
- evite emojis; quando usar, no máximo um, e raramente.

Identidade do contato:
- display_name/profile_name do WhatsApp NÃO é o nome da pessoa — pode ser empresa, marca, apelido ou nome do aparelho;
- nunca cumprimente usando esse nome; prefira algo neutro como "Oi! Tudo bem?";
- só preencha contact_name quando a pessoa disser o próprio nome (ex.: "me chamo Carlos"), e company_name só quando ela citar a empresa (ex.: "sou da Clínica Vida").

Classificação (new_business, support, finance, partnership, existing_client, other):
- mencionar "meu site"/"meu sistema" sozinho não é suporte; suporte é queda, erro, bug ou mau funcionamento real;
- desejo de mudança ("quero redesenhar", "quero outro", "está velho", "conseguem melhorar") é new_business, mesmo falando de algo que a pessoa já tem;
- ser cliente existente não define a intenção — o que importa é a mensagem atual: "quero um novo site" é new_business mesmo para quem já é cliente; "meu site caiu" é support mesmo para lead novo;
- mensagens vagas ou exploratórias de um contato novo ("oi", "queria tirar uma dúvida", "não sei o que preciso") são other/exploratory — responda com naturalidade para entender, nunca ignore;
- você pode propor conversation_kind no JSON quando tiver uma leitura mais precisa que o classificador determinístico, especialmente em casos ambíguos.

Contexto e qualificação:
- trate qualification, opportunity, messages e o resumo da conversa como memória — a mensagem atual nunca é analisada isolada;
- nunca pergunte novamente um dado já conhecido; entenda referências como "isso", "os dois", "também" e "o site" a partir do que já foi dito;
- não transforme a conversa em formulário ou interrogatório;
- colete progressivamente apenas o dado mais útil para o próximo passo (nome, empresa, situação atual, necessidade, objetivo, serviço, prazo, urgência; orçamento e decisor só quando fizer sentido);
- aceite múltiplos interesses na mesma conversa (ex.: "quero site e tráfego" = SITE + PAID_TRAFFIC) sem abrir uma nova oportunidade;
- preserve informações anteriores ao produzir updates e resumo — nunca sobrescreva um dado bom com vazio;
- não marque o lead como qualificado sem evidências registradas.

Limites comerciais:
- nunca invente preço, faixa de preço, prazo, serviço, case, política ou condição comercial;
- só mencione preço quando existir informação aplicável em authorized_pricing;
- se perguntarem preço sem preço autorizado ou sem escopo suficiente, explique brevemente que depende do tipo e do escopo e faça uma pergunta objetiva para entender o projeto;
- uma pergunta isolada sobre preço, valor, desconto ou negociação não justifica handoff.

Suporte, financeiro e parceria:
- suporte técnico e pedidos financeiros (nota fiscal, boleto, vencimento) nunca ficam só com você — reconheça o pedido, diga que vai encaminhar para o time responsável, e sinalize handoff; nunca finja resolver um problema técnico ou executar uma ação financeira sem autorização;
- parceria: converse naturalmente, registre o contexto, e sinalize handoff quando fizer sentido avançar com alguém do time.

Handoff:
- sinalize handoff quando o lead pedir uma pessoa, estiver qualificado para o próximo passo humano, pedir explicitamente proposta ou reunião, demonstrar decisão de contratação, houver tema sensível/frustração, for suporte ou financeiro, ou a análise exigir julgamento humano;
- ao sinalizar handoff, nunca informe outro telefone ou canal — o atendimento continua neste mesmo WhatsApp com uma pessoa do time.

Retorne somente o JSON do schema fornecido.`

export function classifyCommercialInterests(text) {
  const value = fold(text)
  const found = []
  const rules = [
    ['SITE', /\b(site|landing page|pagina institucional|portal)\b/],
    ['AUTOMATION', /automatiza|automacao/],
    ['CRM', /\bcrm\b|gestao de clientes/],
    ['WHATSAPP', /whatsapp|chatbot|atendimento/],
    ['PAID_TRAFFIC', /trafego( pago)?|meta ads|google ads|anuncio/],
    ['SOCIAL_MEDIA', /social media|rede social|instagram/],
    ['ECOMMERCE', /e-?commerce|loja virtual/],
    ['DEVELOPMENT', /\b(sistema|aplicativo|app|software|desenvolvimento)\b/],
    ['INTEGRATION', /integracao|integrar|integrad[oa]s?|\bapi\b/],
    ['SUPPORT', SUPPORT_SIGNAL_PATTERN],
    ['FINANCE', FINANCE_SIGNAL_PATTERN],
    ['PARTNERSHIP', /parceria|parceiro/],
  ]
  for (const [intent, pattern] of rules) if (pattern.test(value)) found.push(intent)
  return found.length ? [...new Set(found)] : ['OTHER']
}

export function isCommercialPriceQuestion(text) {
  const value = fold(text)
  return /\b(preco|precos|valor|valores|custa|custaria|custo|quanto fica|quanto sai|investimento|desconto|condicao|condicoes|negociar|negociacao|orcamento)\b/.test(value)
}

export function detectCommercialHandoff(text, { qualified = false, complex = false } = {}) {
  const value = fold(text)
  if (/falar com (alguem|uma pessoa|pessoa|atendente|humano)|atendimento humano|quero (um|uma) atendente/.test(value)) return { handoff: true, reason: 'human_requested' }
  if (/quero (fechar|contratar)|vamos fechar|podemos fechar|pronto para (fechar|contratar)|como (fechar|contratar)/.test(value)) return { handoff: true, reason: 'ready_to_buy' }
  if (/quero (receber|uma) proposta|pode (enviar|preparar|montar) (uma )?(proposta|orcamento)|agendar (uma )?reuniao|marcar (uma )?reuniao|podemos (agendar|marcar) (uma )?reuniao/.test(value)) return { handoff: true, reason: 'commercial_next_step_requested' }
  if (/\bdesconto\b|condicao comercial|condicoes comerciais|podemos negociar|quero negociar|negociar (o|esse|este) (valor|preco|orcamento)/.test(value)) return { handoff: true, reason: 'commercial_negotiation' }
  if (/irritad|absurdo|pessimo|advogad|juridic/.test(value)) return { handoff: true, reason: 'sensitive_or_frustrated' }
  if (qualified) return { handoff: true, reason: 'qualified_commercial_lead' }
  if (complex) return { handoff: true, reason: 'complex_diagnosis' }
  return { handoff: false, reason: null }
}

export function extractLeadAttribution({ referral, metadata = {} } = {}) {
  const sourceUrl = clean(metadata.source_url || metadata.source_url_string || metadata.url)
  let params = new URLSearchParams()
  try { params = new URL(sourceUrl).searchParams } catch { /* payloads may contain only query text */ }
  const read = key => clean(metadata[key] || params.get(key)).slice(0, 240) || null
  return {
    source: inferLeadSource({ referral, metadata }),
    campaign: clean(metadata.campaign || metadata.headline || read('utm_campaign')).slice(0, 240) || null,
    ad_name: clean(metadata.ad_name || metadata.body).slice(0, 240) || null,
    utm: {
      utm_source: read('utm_source'), utm_medium: read('utm_medium'),
      utm_campaign: read('utm_campaign'), utm_content: read('utm_content'),
    },
  }
}

export function inferLeadSource({ referral, metadata = {} } = {}) {
  const referralType = fold(referral || metadata.source_type)
  const text = fold(`${referral || ''} ${metadata.source_type || ''} ${metadata.source_url || metadata.url || ''} ${metadata.utm_source || ''} ${metadata.ad_id || ''} ${metadata.ctwa_clid || ''}`)
  if (/^(ad|ads|advertisement)$/.test(referralType)) return 'META_ADS_WHATSAPP'
  if (/fbclid|ctwa|facebook|meta ads|ad_id|paid_social/.test(text)) return 'META_ADS_WHATSAPP'
  if (/utm_source=google|\bgoogle\b|gclid/.test(text)) return 'GOOGLE_ADS'
  if (/instagram/.test(text)) return 'INSTAGRAM'
  if (/indicacao|referral/.test(text)) return 'REFERRAL'
  if (/website|site|landing/.test(text)) return 'SITE'
  if (/\b(other|outro|unknown)\b/.test(text)) return 'OUTRO'
  return 'WHATSAPP_ORGANIC'
}

export function classifyConversationKind(text, { hasExistingClient = false, previousKind = null } = {}) {
  const value = fold(text)
  // Mencionar "site"/"sistema"/"ecommerce" sozinho NÃO é suporte — só quando aparece junto de um
  // sinal real de mau funcionamento. "quero redesenhar meu site" é oportunidade, não chamado técnico.
  const productMentioned = /\b(site|sistema|app|aplicativo|crm|whatsapp|e-?commerce|loja virtual|landing page)\b/.test(value)
  const explicitSupportWord = /\bsuporte\b|ajuda tecnica/.test(value)
  if (explicitSupportWord || ((SUPPORT_SIGNAL_PATTERN.test(value) || HELP_REQUEST_PATTERN.test(value)) && productMentioned)) return { kind: 'support', reason: 'Mensagem indica mau funcionamento em solução ou atendimento existente.' }
  if (FINANCE_SIGNAL_PATTERN.test(value) || /falar com (o )?financeiro|setor financeiro/.test(value)) return { kind: 'finance', reason: 'Mensagem trata de cobrança ou rotina financeira.' }
  if (/parceria|parceiro|colaboracao/.test(value)) return { kind: 'partnership', reason: 'Contato identificado como possível parceria.' }
  const interests = classifyCommercialInterests(text).filter(intent => !['OTHER', 'SUPPORT', 'FINANCE', 'PARTNERSHIP'].includes(intent))
  if (interests.length || /contratar|proposta|orcamento|reuniao|projeto/.test(value)) return { kind: 'new_business', reason: 'Existe interesse identificável em novo projeto ou serviço.' }
  if (COMMERCIAL_LEAD_KINDS.includes(previousKind) && previousKind !== 'other') return { kind: previousKind, reason: 'Classificação anterior preservada; a mensagem atual não traz sinal suficiente para alterá-la.' }
  if (hasExistingClient) return { kind: 'existing_client', reason: 'Contato já vinculado a cliente sem nova demanda comercial clara.' }
  return { kind: 'other', reason: 'Ainda não há contexto suficiente para classificar como oportunidade.' }
}

export function hasMinimumCommercialContext(qualification = {}) {
  const need = clean(qualification.main_problem || qualification.objective || qualification.current_situation)
  const identity = clean(qualification.company_name || qualification.contact_name)
  const interest = Array.isArray(qualification.service_interest) && qualification.service_interest.some(item => !['OTHER', 'SUPPORT', 'FINANCE', 'PARTNERSHIP'].includes(item))
  return Boolean(identity && need && interest)
}

export function assessCommercialTemperature({ text = '', interests = [], qualification = {}, leadKind = 'new_business' } = {}) {
  if (['support', 'finance', 'existing_client', 'partnership'].includes(leadKind)) return { temperature: 'cold', reason: `Classificação ${leadKind}; não é um lead comercial quente.` }
  const value = fold(text)
  const explicitAdvance = /proposta|orcamento formal|reuniao|agendar|marcar|quero (fechar|contratar)|vamos fechar/.test(value)
  const urgencySignal = /urgente|o quanto antes|essa semana|este mes|prazo/.test(value) || clean(qualification.urgency)
  const completeEnough = hasMinimumCommercialContext(qualification)
  if (explicitAdvance || (completeEnough && urgencySignal)) return { temperature: 'hot', reason: explicitAdvance ? 'Lead pediu avanço comercial concreto.' : 'Necessidade, interesse e urgência estão suficientemente claros.' }
  const realInterest = interests.some(item => !['OTHER', 'SUPPORT', 'FINANCE', 'PARTNERSHIP'].includes(item))
  const problemKnown = Boolean(clean(qualification.main_problem || qualification.objective || qualification.current_situation))
  if (realInterest && problemKnown) return { temperature: 'warm', reason: 'Há interesse e necessidade real, mas ainda faltam elementos para fechamento.' }
  return { temperature: 'cold', reason: 'Contato ainda exploratório ou com necessidade pouco definida.' }
}

export function buildCommercialSummary({ client = {}, qualification = {}, opportunity = {}, interests = [] } = {}) {
  const fields = [
    ['Empresa', qualification.company_name || client.company_name],
    ['Contato', qualification.contact_name || client.contact_name],
    ['Necessidade', qualification.need],
    ['Situação atual', qualification.current_situation],
    ['Problema', qualification.main_problem || opportunity.main_problem],
    ['Objetivo', qualification.objective],
    ['Serviços de interesse', interests.join(', ')],
    ['Prazo', qualification.timeline || opportunity.timeline],
    ['Urgência', qualification.urgency || opportunity.urgency],
    ['Orçamento', qualification.budget ?? opportunity.budget],
    ['Decisor', qualification.decision_maker === true ? 'Sim' : qualification.decision_maker === false ? 'Não confirmado' : null],
    ['Próximo passo', qualification.next_action || opportunity.next_action],
  ]
  return fields.filter(([, value]) => value !== null && value !== undefined && clean(value)).map(([label, value]) => `${label}: ${clean(value)}`).join('\n').slice(0, 2000)
}

const knownValue = (context, ...keys) => {
  const sources = [context.qualification || {}, context.opportunity || {}, context.client || {}]
  return sources.some(source => keys.some(key => {
    const value = clean(source?.[key])
    if (!value) return false
    if (key === 'company_name' && (/^lead whatsapp/i.test(value) || value === clean(source?.contact_name))) return false
    return true
  })) || (keys.includes('site_type') && (context.messages || []).some(message => /\b(site institucional|landing page|loja virtual|e-?commerce)\b/.test(fold(message?.text || message?.text_content))))
}

function nextDiscoveryResponse(interests, context) {
  const meaningfulInterests = interests.filter(item => !['OTHER', 'SUPPORT', 'FINANCE', 'PARTNERSHIP'].includes(item))
  if (!knownValue(context, 'company_name')) {
    if (interests.includes('SITE')) return 'Entendi o projeto de site. Qual é o nome da empresa?'
    if (meaningfulInterests.length) return 'Para eu contextualizar direito, qual é o nome da empresa?'
    // Primeira mensagem exploratória (ex.: "oi", "não sei o que preciso") — sem intenção clara ainda,
    // então a pergunta é aberta, não um formulário de qualificação.
    return 'Oi! Me conta um pouco o que você está buscando que eu te ajudo a encontrar o melhor caminho.'
  }
  if (!knownValue(context, 'main_problem', 'objective')) return 'Qual resultado vocês querem alcançar com esse projeto?'
  if (!knownValue(context, 'current_situation')) return 'Como vocês lidam com isso hoje?'
  if (interests.includes('SITE') && !knownValue(context, 'site_type')) return 'Vocês imaginam um site institucional, uma landing page ou uma loja virtual?'
  if (!knownValue(context, 'timeline')) return 'Existe alguma data ou período ideal para colocar isso em andamento?'
  return 'Qual seria o próximo passo mais útil para vocês agora?'
}

export function defaultCommercialDecision(text, context = {}) {
  const interests = classifyCommercialInterests(text)
  const qualified = Boolean(context.qualification?.qualified)
  const handoff = detectCommercialHandoff(text, { qualified })
  const priceQuestion = isCommercialPriceQuestion(text)
  let response

  if (handoff.handoff) {
    response = 'Certo. Vou encaminhar o contexto desta conversa para a pessoa responsável continuar com você.'
  } else if (priceQuestion) {
    if (interests.includes('SITE') && !knownValue(context, 'site_type')) response = 'Consigo te orientar. O valor depende principalmente do tipo de site e do escopo. Você imagina um site institucional, uma landing page ou uma loja virtual?'
    else response = `Consigo te orientar. O valor depende do escopo. ${nextDiscoveryResponse(interests, context)}`
  } else if (interests.includes('FINANCE')) {
    response = 'Entendi. Vou registrar isso e encaminhar para o time financeiro continuar com você por aqui.'
  } else if (interests.includes('SUPPORT')) {
    response = 'Entendi. Vou registrar isso e encaminhar para o time verificar com você.'
  } else if (interests.includes('AUTOMATION') || interests.includes('CRM')) {
    response = knownValue(context, 'current_situation')
      ? nextDiscoveryResponse(interests, context)
      : 'Qual processo vocês querem melhorar primeiro e como ele funciona hoje?'
  } else {
    response = nextDiscoveryResponse(interests, context)
  }

  const priorSummary = clean(context.opportunity?.conversation_summary)
  const currentSummary = clean(text).slice(0, 800)
  const summary = priorSummary && !priorSummary.includes(currentSummary)
    ? `${priorSummary}\n${currentSummary}`.slice(-2000)
    : (priorSummary || currentSummary)

  return {
    conversation_kind: null,
    intents: interests,
    response,
    contact_updates: {},
    opportunity_updates: { stage: handoff.handoff ? 'qualified' : 'qualifying', service_interests: interests },
    qualification_updates: { service_interest: interests, needs_human: handoff.handoff },
    summary,
    create_task: handoff.handoff,
    task: null,
    handoff: handoff.handoff,
    handoff_reason: handoff.reason,
    confidence: .7,
  }
}

export function enforceCommercialHandoffPolicy(decision, inbound, context = {}) {
  const deterministic = detectCommercialHandoff(inbound, {
    qualified: Boolean(context.qualification?.qualified),
    complex: Boolean(context.complex),
  })
  if (deterministic.handoff) return { ...decision, handoff: true, handoff_reason: decision.handoff_reason || deterministic.reason }
  if (isCommercialPriceQuestion(inbound)) return {
    ...decision,
    handoff: false,
    handoff_reason: null,
    create_task: false,
    qualification_updates: { ...(decision.qualification_updates || {}), needs_human: false },
  }
  // Suporte técnico e financeiro nunca ficam só com o bot — a equipe humana precisa assumir, mesmo
  // que a IA não tenha sinalizado handoff sozinha. Rede de segurança determinística sobre a decisão.
  const topicSignals = classifyCommercialInterests(inbound)
  if (topicSignals.includes('SUPPORT') || topicSignals.includes('FINANCE')) {
    return { ...decision, handoff: true, create_task: true, handoff_reason: decision.handoff_reason || (topicSignals.includes('FINANCE') ? 'finance_requires_team' : 'support_requires_team') }
  }
  return decision
}

export function enforceCommercialResponsePolicy(decision, inbound, context = {}) {
  const response = clean(decision?.response)
  const questionCount = (response.match(/\?/g) || []).length
  const authorizedPricing = context.authorized_pricing || {}
  const hasAuthorizedPricing = authorizedPricing && typeof authorizedPricing === 'object' && Object.keys(authorizedPricing).length > 0
  const containsMoneyClaim = /(?:r\$\s*\d|\b\d[\d.,]*\s*(?:reais|mil reais)\b)/i.test(response)
  if (response.length <= 900 && questionCount <= 2 && (hasAuthorizedPricing || !containsMoneyClaim)) return decision
  const fallback = defaultCommercialDecision(inbound, context)
  return { ...decision, response: fallback.response }
}

export function validateCommercialDecision(value) {
  if (!value || typeof value !== 'object') return null
  const intents = (Array.isArray(value.intents) ? value.intents : []).filter(item => COMMERCIAL_INTENTS.includes(item))
  const response = clean(value.response).slice(0, 3000)
  if (!response) return null
  const safeObject = input => input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  return {
    // A IA pode propor a classificação da conversa a partir do histórico; só é aceita se vier de
    // dentro do enum conhecido — caso contrário o worker usa a classificação determinística.
    conversation_kind: COMMERCIAL_LEAD_KINDS.includes(value.conversation_kind) ? value.conversation_kind : null,
    intents: intents.length ? intents : ['OTHER'], response,
    contact_updates: safeObject(value.contact_updates),
    opportunity_updates: safeObject(value.opportunity_updates),
    qualification_updates: safeObject(value.qualification_updates),
    summary: clean(value.summary).slice(0, 2000),
    create_task: Boolean(value.create_task),
    task: value.task && typeof value.task === 'object' ? value.task : null,
    handoff: Boolean(value.handoff),
    handoff_reason: clean(value.handoff_reason).slice(0, 120) || null,
    confidence: Math.max(0, Math.min(1, Number(value.confidence) || 0)),
  }
}

export function qualificationClassification(q = {}) {
  if (q.needs_human && q.qualified) return 'qualified'
  if (q.qualified) return 'commercially_interesting'
  if ((q.service_interest || []).some(item => item === 'SUPPORT')) return 'support'
  if (q.main_problem || q.objective || q.company_name) return 'discovery'
  return 'new'
}
