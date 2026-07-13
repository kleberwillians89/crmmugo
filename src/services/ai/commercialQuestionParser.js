import { SERVICE_CATALOG } from '../../config/serviceCatalog.js'

const aliases = {
  social: ['social', 'social media', 'social midia', 'redes sociais', 'conteudo'],
  traffic: ['trafego', 'midia paga', 'meta ads', 'google ads', 'performance'],
  site: ['site', 'site institucional', 'one page'],
  ecommerce: ['ecommerce', 'e-commerce', 'loja', 'shopify'],
  landing: ['landing page', 'lp'],
  ai: ['ia', 'inteligencia artificial', 'agente', 'agente de ia'],
  automation: ['automacao', 'chatbot', 'whatsapp'],
}

const numberWords = { um:1,uma:1,dois:2,duas:2,tres:3,quatro:4,cinco:5,seis:6,sete:7,oito:8,nove:9,dez:10,onze:11,doze:12,treze:13,quatorze:14,quinze:15,vinte:20,trinta:30,quarenta:40,cinquenta:50,cem:100 }

export function normalizeCommercialQuestion(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

export function parseBrazilianMoneyFromText(value) {
  const text = normalizeCommercialQuestion(value).replace(/r\$\s*/g, '')
  const numeric = text.match(/(?:^|\s)(\d{1,3}(?:\.\d{3})+|\d+(?:[.,]\d+)?)\s*(mil|k)?(?:\s|$)/)
  if (numeric) {
    const raw = numeric[1].includes('.') && !numeric[1].includes(',') ? numeric[1].replace(/\./g, '') : numeric[1].replace(/\./g, '').replace(',', '.')
    return Number(raw) * (numeric[2] ? 1000 : 1)
  }
  const words = Object.entries(numberWords).find(([word]) => new RegExp(`\\b${word}\\s+mil\\b`).test(text))
  return words ? words[1] * 1000 : null
}

export function findServiceFromText(value) {
  const text = normalizeCommercialQuestion(value)
  const alias = Object.entries(aliases).find(([, words]) => words.some((word) => text.includes(word)))?.[0]
  if (!alias) return null
  const patterns = { social:/^social-/,traffic:/^midia-/,site:/^site-/,ecommerce:/^ecommerce-/,landing:/^lp-/,ai:/^(agente|avatar)-/,automation:/^(chatbot|fluxo|automacao)-/ }
  return { id: alias, label: {social:'Social Media',traffic:'Tráfego Pago',site:'Sites',ecommerce:'E-commerce',landing:'Landing Page',ai:'Inteligência Artificial',automation:'Automação'}[alias], services: SERVICE_CATALOG.filter((service) => patterns[alias].test(service.id)).filter((service)=>service.billingType!=='percentage') }
}

export function calculateContractsForTarget(target, services) {
  return services.filter((service)=>Number(service.recommendedPrice)>0).map((service)=>{const quantity=Math.ceil(target/Number(service.recommendedPrice));return {service:service.name,quantity,unitPrice:Number(service.recommendedPrice),total:quantity*Number(service.recommendedPrice)}})
}

export function calculateServiceMixForTarget(target, services = SERVICE_CATALOG.filter((service) => service.billingType === 'recurring')) {
  const rows = services.filter((service) => Number(service.recommendedPrice) > 0).slice(0, 6)
  let best = null
  const consider = (items) => {
    const active = items.filter((item) => item.quantity)
    const total = active.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
    if (total < target) return
    const candidate = { items: active, total, excess: total - target }
    const candidateCount = active.reduce((sum, item) => sum + item.quantity, 0)
    const bestCount = best?.items.reduce((sum, item) => sum + item.quantity, 0) ?? Infinity
    if (!best || candidate.excess < best.excess || (candidate.excess === best.excess && candidateCount < bestCount)) best = candidate
  }
  rows.forEach((first, firstIndex) => {
    const firstPrice = Number(first.recommendedPrice)
    for (let firstQuantity = 0; firstQuantity <= Math.ceil(target / firstPrice) + 1; firstQuantity += 1) {
      consider([{ service: first.name, quantity: firstQuantity, unitPrice: firstPrice }])
      rows.slice(firstIndex + 1).forEach((second, offset) => {
        const secondPrice = Number(second.recommendedPrice)
        for (let secondQuantity = 0; secondQuantity <= Math.ceil(target / secondPrice) + 1; secondQuantity += 1) {
          const base = firstQuantity * firstPrice + secondQuantity * secondPrice
          const pair = [{ service: first.name, quantity: firstQuantity, unitPrice: firstPrice }, { service: second.name, quantity: secondQuantity, unitPrice: secondPrice }]
          consider(pair)
          rows.slice(firstIndex + offset + 2).forEach((third) => {
            const thirdPrice = Number(third.recommendedPrice)
            const thirdQuantity = Math.max(0, Math.ceil((target - base) / thirdPrice))
            consider([...pair, { service: third.name, quantity: thirdQuantity, unitPrice: thirdPrice }])
          })
        }
      })
    }
  })
  return best
}

export function parseCommercialQuestion(question) {
  const normalized=normalizeCommercialQuestion(question)
  return { normalized, target:parseBrazilianMoneyFromText(normalized), service:findServiceFromText(normalized), asksContractCount:/quantos?\s+(contratos|clientes)/.test(normalized), asksGoal:/bater|alcancar|chegar|meta/.test(normalized) }
}
