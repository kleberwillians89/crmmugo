// Botões da equipe com link rastreado: o botão aponta para /functions/v1/cta-redirect?l=<id>, que registra o
// clique e redireciona para o WhatsApp da pessoa. Se o registro falhar, o botão segue com o link direto.
export async function trackCtas(admin, { organizationId, conversationId, ctas = [], baseUrl }) {
  if (!ctas.length || !baseUrl || !conversationId) return ctas
  const batchId = crypto.randomUUID()
  const inserted = await admin.from('whatsapp_cta_links').insert(ctas.map((cta) => ({
    organization_id: organizationId, conversation_id: conversationId, batch_id: batchId, label: cta.label, target_url: cta.url,
  }))).select('id,label')
  if (inserted.error || !inserted.data?.length) return ctas
  const root = String(baseUrl).replace(/\/+$/, '')
  return ctas.map((cta) => {
    const row = inserted.data.find((item) => item.label === cta.label)
    return row ? { ...cta, url: `${root}/functions/v1/cta-redirect?l=${row.id}`, link_id: row.id, batch_id: batchId } : cta
  })
}
