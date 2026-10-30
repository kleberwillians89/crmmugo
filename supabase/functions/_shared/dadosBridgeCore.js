// Regras puras da ponte CRM <-> Mugô Dados (testadas em tests/dados-eventos.test.mjs).

// Templates enviados pelo Dados que perguntam algo ao cliente com botões de resposta rápida
// ("Sim, quero ver" / "Agora não"). O clique volta para o Dados, nunca para o robô comercial.
export const DADOS_INVITE_TEMPLATE = /^mugo_convite_/

export const isDadosInviteReply = (content, originalTemplateName) =>
  (content?.type === 'button' || content?.type === 'interactive') && DADOS_INVITE_TEMPLATE.test(String(originalTemplateName || ''))

const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

export const CONTENT_ACTIONS = {
  aprovado: { prefix: 'CONTEÚDO — Publicar', verb: 'aprovou', priority: 'medium' },
  ajuste_solicitado: { prefix: 'CONTEÚDO — Ajustar', verb: 'pediu ajuste em', priority: 'high' },
  editado_pelo_cliente: { prefix: 'CONTEÚDO — Conferir edição', verb: 'editou', priority: 'high' },
}

// Evento de conteúdo vindo do Dados -> tarefa no CRM. Nunca confia em ids do chamador além do item.
export const contentTask = (event, clientName) => {
  const action = CONTENT_ACTIONS[event?.action]
  if (!action) return null
  const title = clip(event.title, 140) || 'post'
  const who = clip(event.actor_name, 80) || 'O cliente'
  const when = /^\d{4}-\d{2}-\d{2}/.test(String(event.scheduled_at || '')) ? String(event.scheduled_at).slice(0, 10) : null
  const lines = [
    `${who} ${action.verb} "${title}" no Mugô Dados.`,
    event.comment ? `Comentário: ${clip(event.comment, 600)}` : null,
    event.changes?.length ? `O que mudou: ${event.changes.map((c) => clip(c, 60)).join(', ')}` : null,
    when ? `Data do post: ${when.slice(8, 10)}/${when.slice(5, 7)}` : null,
    event.link ? `Abrir no Dados: ${clip(event.link, 300)}` : null,
  ].filter(Boolean)
  return {
    title: `${action.prefix} · ${clip(clientName, 60) || 'cliente'} · ${title}`.slice(0, 200),
    priority: action.priority,
    // Aprovado: prazo é o dia do post; ajuste/edição: hoje.
    due_date: event.action === 'aprovado' && when ? when : null,
    notes: lines.join('\n'),
    tags: ['conteudo', 'mugo-dados'],
  }
}
