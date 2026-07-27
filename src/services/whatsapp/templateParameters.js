const clean = value => String(value ?? '').trim()
const type = value => clean(value).toUpperCase()
const variables = text => [...new Set([...clean(text).matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map(match => clean(match[1])))]

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
