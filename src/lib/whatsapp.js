const digits=(value)=>String(value??'').replace(/\D/g,'')
export function normalizeBrazilianPhone(value){let phone=digits(value);if(phone.startsWith('00'))phone=phone.slice(2);if(!phone.startsWith('55')&&(phone.length===10||phone.length===11))phone=`55${phone}`;return phone}
export function isValidBrazilianPhone(value){return /^55[1-9]{2}9?\d{8}$/.test(normalizeBrazilianPhone(value))}
export function buildWhatsAppLink(phone,message){if(!isValidBrazilianPhone(phone))return '';return `https://wa.me/${normalizeBrazilianPhone(phone)}?text=${encodeURIComponent(message)}`}
const hello=(name)=>`Olá, ${name||'tudo bem'}!`
export const buildClientMessage=({name})=>`${hello(name)}\n\nTudo bem?\n\nEstou entrando em contato pela Agência Mugô.\n\nFico à disposição.`
export const buildProposalMessage=({name,service})=>`${hello(name)}\n\nTudo bem?\n\nEstou entrando em contato para conversarmos sobre a proposta da Agência Mugô referente a ${service||'nossos serviços'}.\n\nFico à disposição.`
export const buildContractMessage=({name})=>`${hello(name)}\n\nEstou entrando em contato para alinharmos as informações do contrato referente aos serviços da Agência Mugô.\n\nFico à disposição.`
export const buildInvoiceMessage=({name,value,dueDate,pixKey,bankName})=>`${hello(name)}\n\nSegue a informação de pagamento referente aos serviços da Agência Mugô.\n\nValor: ${value}\nVencimento: ${dueDate}\n\nPIX: ${pixKey||'Não informado'}\nBanco: ${bankName||'Não informado'}\n\nCaso o pagamento já tenha sido realizado, por favor desconsidere esta mensagem.\n\nEquipe Mugô`
export const buildPaymentConfirmationMessage=({name,reference,value})=>`${hello(name)}\n\nConfirmamos o recebimento do pagamento referente a ${reference}.\n\nValor: ${value}\n\nMuito obrigado!\n\nEquipe Mugô`
