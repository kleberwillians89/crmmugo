// Prospect que respondeu vira lead no funil: cliente (status lead) + oportunidade + tarefa para o responsável.
const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max)
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

export async function convertProspectToLead(admin, { organizationId, prospect, channel = 'email', snippet = '', temperature = 'warm', replyCategory = null }) {
  if (prospect.opportunity_id) return { opportunity_id: prospect.opportunity_id, client_id: prospect.client_id, created: false }
  const settings = await admin.from('commercial_settings').select('commercial_owner_id').eq('organization_id', organizationId).maybeSingle()
  const ownerId = prospect.owner_id || settings.data?.commercial_owner_id || null

  let clientId = prospect.client_id
  if (!clientId && prospect.contact_email) {
    const existing = await admin.from('clients').select('id').eq('organization_id', organizationId).ilike('email', clean(prospect.contact_email, 320)).neq('status', 'archived').limit(1)
    clientId = existing.data?.[0]?.id || null
  }
  if (!clientId) {
    const inserted = await admin.from('clients').insert({
      organization_id: organizationId,
      company_name: clean(prospect.company_name, 240),
      contact_name: clean(prospect.contact_name, 240) || null,
      email: clean(prospect.contact_email, 320) || null,
      phone: clean(prospect.contact_phone, 40) || null,
      website: clean(prospect.website, 300) || null,
      instagram: clean(prospect.instagram, 200) || null,
      segment: clean(prospect.segment, 120) || null,
      lead_source: channel === 'linkedin' ? 'PROSPECCAO_LINKEDIN' : 'PROSPECCAO_EMAIL',
      status: 'lead',
      notes: clean(prospect.hook, 1000) || null,
    }).select('id').single()
    if (inserted.error) throw inserted.error
    clientId = inserted.data.id
  }

  // Já existe negócio aberto com esse cliente (ex.: chegou antes pelo WhatsApp)? Usa o mesmo — nunca duplica.
  const open = await admin.from('commercial_opportunities').select('id').eq('organization_id', organizationId).eq('client_id', clientId).not('stage', 'in', '(won,lost)').order('created_at', { ascending: false }).limit(1)
  if (open.error) throw open.error
  if (open.data?.[0]) {
    const reused = open.data[0].id
    await admin.from('commercial_opportunities').update({ last_interaction_at: new Date().toISOString(), next_action: 'Responder o prospect e marcar conversa', next_action_at: new Date().toISOString() }).eq('id', reused).eq('organization_id', organizationId)
    await admin.from('prospects').update({ status: 'replied', replied_at: new Date().toISOString(), client_id: clientId, opportunity_id: reused }).eq('id', prospect.id).eq('organization_id', organizationId)
    await admin.from('prospect_activities').insert({ organization_id: organizationId, prospect_id: prospect.id, channel, activity_type: 'linked_to_existing_opportunity', content: clean(snippet, 1000) || null, metadata: { opportunity_id: reused, client_id: clientId, reply_category: replyCategory }, created_by: null })
    return { opportunity_id: reused, client_id: clientId, created: false }
  }

  const opportunity = await admin.from('commercial_opportunities').insert({
    organization_id: organizationId,
    client_id: clientId,
    assigned_to: ownerId,
    name: clean(prospect.company_name, 240),
    contact_role: clean(prospect.contact_role, 240) || null,
    email: clean(prospect.contact_email, 320) || null,
    source: channel === 'linkedin' ? 'prospeccao_linkedin' : 'prospeccao_email',
    stage: 'new_lead',
    temperature,
    temperature_reason: replyCategory ? `Respondeu a prospecção ativa (${replyCategory}).` : 'Respondeu a prospecção ativa.',
    lead_kind: 'new_business',
    main_problem: clean(prospect.hook, 1000) || null,
    conversation_summary: clean(snippet, 1000) || null,
    next_action: 'Responder o prospect e marcar conversa',
    next_action_at: new Date().toISOString(),
    last_interaction_at: new Date().toISOString(),
    metadata: { prospect_id: prospect.id, channel, fit_score: prospect.fit_score ?? null, reply_category: replyCategory },
  }).select('id').single()
  if (opportunity.error) throw opportunity.error

  await admin.from('crm_tasks').upsert({
    organization_id: organizationId,
    title: `COMERCIAL — Responder ${clean(prospect.contact_name, 80) || clean(prospect.company_name, 80)} (respondeu ${channel === 'linkedin' ? 'no LinkedIn' : 'o e-mail'})`,
    status: 'pending', priority: 'high', due_date: today(), assigned_to: ownerId, client_id: clientId,
    opportunity_id: opportunity.data.id, task_type: 'commercial', source: 'automation', source_ref: `prospect-reply:${prospect.id}`,
    notes: [clean(prospect.hook, 600), snippet ? `Resposta: ${clean(snippet, 600)}` : ''].filter(Boolean).join('\n'),
  }, { onConflict: 'organization_id,source_ref' })

  await admin.from('prospects').update({ status: 'replied', replied_at: new Date().toISOString(), client_id: clientId, opportunity_id: opportunity.data.id }).eq('id', prospect.id).eq('organization_id', organizationId)
  await admin.from('prospect_activities').insert({ organization_id: organizationId, prospect_id: prospect.id, channel, activity_type: 'converted_to_lead', content: clean(snippet, 1000) || null, metadata: { opportunity_id: opportunity.data.id, client_id: clientId }, created_by: null })
  if (prospect.contact_email) {
    await admin.from('email_contacts').upsert({ organization_id: organizationId, email: clean(prospect.contact_email, 320).toLowerCase(), name: clean(prospect.contact_name, 200) || null, client_id: clientId, prospect_id: prospect.id, source: 'prospect_replied', tags: ['lead', 'prospeccao'] }, { onConflict: 'organization_id,email', ignoreDuplicates: true })
  }
  return { opportunity_id: opportunity.data.id, client_id: clientId, created: true }
}
