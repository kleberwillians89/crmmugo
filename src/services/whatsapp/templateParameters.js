const clean = value => String(value ?? '').trim()
const type = value => clean(value).toUpperCase()
const variables = text => [...new Set([...clean(text).matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map(match => clean(match[1])))]

export const templateSearchText = template => clean([
  template.display,
  template.name,
  template.category,
  template.purpose,
  template.preview,
].join(' ')).toLocaleLowerCase('pt-BR')

export const templateCategory = template => {
  const category = type(template?.category)
  if (category === 'MARKETING') return 'marketing'
  if (category === 'AUTHENTICATION') return 'authentication'
  return 'utility'
}

export const maskTemplateRecipient = value => {
  const normalized = clean(value).replace(/\D/g, '')
  return normalized ? `${'•'.repeat(Math.max(6, normalized.length - 4))}${normalized.slice(-4)}` : 'telefone não informado'
}

export function suggestTemplateValues(fields = [], context = {}) {
  const client = context.client || {}
  const contract = context.contract || {}
  const installment = context.installment || {}
  const suggestions = {}
  const candidates = {
    nome: client.contact_name || client.trade_name || client.company_name || context.contactName,
    cliente: client.contact_name || client.trade_name || client.company_name || context.contactName,
    cliente_nome: client.contact_name || client.trade_name || client.company_name || context.contactName,
    empresa: client.trade_name || client.company_name,
    responsavel: context.owner,
    valor: installment.amount,
    vencimento: installment.due_date,
    link: context.link,
    codigo: context.code,
    pedido: context.orderNumber,
    numero_pedido: context.orderNumber,
    contrato: contract.number || contract.contract_number || contract.id,
    numero_contrato: contract.number || contract.contract_number || contract.id,
  }
  for (const field of fields) {
    const variable = clean(field.variable).toLocaleLowerCase('pt-BR')
    let value = candidates[variable]
    if (!value && /^\d+$/.test(variable) && Number(variable) === 1) value = candidates.nome
    if (value !== undefined && value !== null && clean(value)) suggestions[field.key] = clean(value)
  }
  return suggestions
}

export function renderTemplatePreview(template = {}, fields = [], values = {}) {
  const component = componentType => (Array.isArray(template.components) ? template.components : []).find(item => type(item.type) === componentType)
  const replace = text => {
    let output = clean(text)
    for (const field of fields.filter(item => item.variable)) {
      output = output.replace(new RegExp(`\\{\\{\\s*${String(field.variable).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}\\}`, 'g'), clean(values[field.key]) || `{{${field.variable}}}`)
    }
    return output
  }
  return {
    header: replace(component('HEADER')?.text),
    body: replace(component('BODY')?.text || template.preview),
    footer: replace(component('FOOTER')?.text || template.footer),
    buttons: Array.isArray(component('BUTTONS')?.buttons) ? component('BUTTONS').buttons.map(button => ({ type: type(button.type), text: clean(button.text), url: replace(button.url) })) : [],
  }
}

export function describeTemplateFields(template = {}) {
  const fields = []
  for (const component of Array.isArray(template.components) ? template.components : []) {
    const componentType = type(component.type)
    if (componentType === 'HEADER') {
      const format = type(component.format)
      for (const variable of variables(component.text)) fields.push({ key: `header_text_${variable}`, component: 'header', kind: 'text', variable, label: `Cabeçalho · ${variable}`, required: true })
      if (['IMAGE','VIDEO','DOCUMENT'].includes(format)) fields.push({ key: `header_${format.toLowerCase()}`, component: 'header', kind: format.toLowerCase(), label: `URL do ${format.toLowerCase()}`, required: true })
    }
    if (componentType === 'BODY') for (const variable of variables(component.text)) fields.push({ key: `body_${variable}`, component: 'body', kind: 'text', variable, label: `Corpo · ${variable}`, required: true })
    if (componentType === 'BUTTONS' && Array.isArray(component.buttons)) component.buttons.forEach((button, index) => {
      const buttonType = type(button.type)
      if (buttonType === 'COPY_CODE') fields.push({ key: `button_${index}_copy_code`, component: 'button', kind: 'coupon_code', index: String(index), subType: 'copy_code', label: `Código para copiar · botão ${index + 1}`, required: true })
      if (buttonType === 'URL' && variables(button.url).length) fields.push({ key: `button_${index}_url`, component: 'button', kind: 'text', index: String(index), subType: 'url', label: `Complemento da URL · botão ${index + 1}`, required: true })
    })
  }
  return fields
}

export function buildTemplateComponents(fields, values = {}) {
  const groups = new Map()
  for (const field of fields) {
    const value = clean(values[field.key])
    if (!value) continue
    const key = field.component === 'button' ? `button:${field.index}` : field.component
    if (!groups.has(key)) groups.set(key, { type: field.component, ...(field.component === 'button' ? { sub_type: field.subType, index: field.index } : {}), parameters: [] })
    const parameter = field.kind === 'coupon_code' ? { type: 'coupon_code', coupon_code: value } : ['image','video','document'].includes(field.kind) ? { type: field.kind, [field.kind]: { link: value } } : { type: 'text', text: value }
    groups.get(key).parameters.push(parameter)
  }
  return [...groups.values()].filter(component => component.parameters.length)
}

export const missingTemplateFields = (fields, values) => fields.filter(field => field.required && !clean(values[field.key]))

export function normalizeTemplateRecipient(value) {
  const normalized = clean(value).replace(/\D/g, '')
  return /^[1-9]\d{11,14}$/.test(normalized) ? normalized : ''
}
