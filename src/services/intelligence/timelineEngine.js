const timestamp = (value) => value ? new Date(value).getTime() : 0
const entry = (id, type, title, date, detail, clientId) => ({ id, type, title, date, detail, clientId })

export function buildTimeline(data = {}) {
  const rows = []
  ;(data.proposals || []).forEach((item) => {
    if (item.sent_at || item.proposal_sent_date) rows.push(entry(`proposal-${item.id}`, 'Proposta', item.title || 'Proposta enviada', item.sent_at || item.proposal_sent_date, item.clients?.company_name || item.client_name || '', item.client_id))
    if (item.closed_at) rows.push(entry(`closed-${item.id}`, 'Assinatura', item.title || 'Proposta fechada', item.closed_at, 'Fechamento registrado', item.client_id))
  })
  ;(data.contracts || []).forEach((item) => {
    if (item.signed_at) rows.push(entry(`signature-${item.id}`, 'Assinatura', item.contract_number || 'Contrato assinado', item.signed_at, item.clients?.company_name || '', item.client_id))
    if (item.start_date) rows.push(entry(`contract-${item.id}`, 'Contrato', item.contract_number || 'Contrato iniciado', item.start_date, item.clients?.company_name || '', item.client_id))
    if (item.end_date) rows.push(entry(`renewal-${item.id}`, 'Renovação', item.contract_number || 'Fim de vigência', item.end_date, item.auto_renew ? 'Renovação automática cadastrada' : 'Revisar renovação', item.client_id))
  })
  ;(data.installments || []).forEach((item) => rows.push(entry(`payment-${item.id}`, 'Pagamento', item.reference_month || 'Parcela', item.paid_at || item.due_date, `${item.status} · ${Number(item.amount || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`, item.client_id)))
  ;(data.documents || []).forEach((item) => rows.push(entry(`upload-${item.id}`, 'Upload', item.file_name, item.uploaded_at, item.document_type, item.client_id)))
  ;(data.events || []).forEach((item) => rows.push(entry(`event-${item.id}`, 'Alteração', item.title, item.created_at, item.description || item.event_type, item.client_id)))
  return rows.filter((item) => timestamp(item.date)).sort((a, b) => timestamp(b.date) - timestamp(a.date))
}
