import { useEffect, useMemo, useState } from 'react'
import { Archive, Check, Clock3, MessageCircle, MoreHorizontal, Pencil, Plus } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { getSecretaryFeed, listWaitingConversations } from '../services/data/tasksRepository'
import { taskCategoryScope } from '../lib/operationalCalendar'
import { buildTodayGroups, describeFeedItem, dueLabel, firstName, greeting, memberForProfile, relatedLabel, waitingFor } from '../lib/todayView'

const PALETTE = ['#191714', '#b22234', '#2f5f8a', '#a8620f', '#2f7d55', '#6b4c9a']
const colorFor = (member, index) => member?.color && member.color !== '#D7A84B' ? member.color : PALETTE[index % PALETTE.length]
const hourInSaoPaulo = (now) => Number(new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(new Date(now)))
const longDate = (iso) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${iso}T12:00:00Z`))
const timeOf = (iso) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

function Avatar({ member, index }) {
  if (!member) return <span className="tv-av empty" title="Sem responsável" />
  return <span className="tv-av" style={{ background: colorFor(member, index) }} title={member.name}>{firstName(member.name).slice(0, 1).toUpperCase()}</span>
}

function TaskRow({ task, today, members, canOperate, onComplete, onEdit, onArchive }) {
  const [menu, setMenu] = useState(false)
  const index = members.findIndex((member) => member.id === task.assigned_to)
  const related = relatedLabel(task) || (taskCategoryScope(task) === 'personal' ? task.category : '')
  const late = task.due_date && task.due_date < today
  return <div className={`tv-row${task.status === 'in_progress' ? ' doing' : ''}`}>
    <button type="button" className="tv-check" disabled={!canOperate} onClick={() => onComplete(task)} aria-label={`Concluir “${task.title}”`}><Check size={11} /></button>
    <button type="button" className="tv-title" onClick={() => canOperate && onEdit(task)}>
      <span>{task.title}</span>
      {task.status === 'in_progress' && <em>em andamento</em>}
    </button>
    <span className="tv-tag">{related}</span>
    <Avatar member={members[index]} index={index} />
    <span className={`tv-due${late ? ' late' : ''}`}>{dueLabel(task, today)}</span>
    {canOperate && <div className="tv-more">
      <button type="button" aria-label="Mais ações" onClick={() => setMenu(!menu)}><MoreHorizontal size={15} /></button>
      {menu && <div className="tv-menu" onMouseLeave={() => setMenu(false)}>
        <button type="button" onClick={() => { setMenu(false); onEdit(task) }}><Pencil size={13} /> Editar ou reagendar</button>
        <button type="button" onClick={() => { setMenu(false); onArchive(task) }}><Archive size={13} /> Arquivar</button>
      </div>}
    </div>}
  </div>
}

function Group({ title, tone, items, empty, ...rest }) {
  if (!items.length && !empty) return null
  return <section className="tv-group">
    <h3 className={tone}>{title} <span>{items.length}</span></h3>
    {items.map((task) => <TaskRow key={task.id} task={task} {...rest} />)}
    {!items.length && <p className="tv-empty">{empty}</p>}
  </section>
}

/**
 * Tela Hoje: lista de tarefas estilo Notion (Atrasadas / Hoje / Próximos dias), conversas esperando
 * e o diário da Secretária no WhatsApp.
 */
export function TodayView({ tasks, today, teamMembers = [], summary = {}, onComplete, onEdit, onArchive, onCreate, onQuickHours, onQuickDecision, onNavigate }) {
  const { profile, canOperate, canAccessFinance } = useAuth()
  const me = useMemo(() => memberForProfile(teamMembers, profile), [teamMembers, profile])
  const [scope, setScope] = useState('mine')
  const [waiting, setWaiting] = useState([]), [feed, setFeed] = useState(null), [now, setNow] = useState(0)
  useEffect(() => {
    let alive = true
    Promise.all([listWaitingConversations(5), getSecretaryFeed(10)]).then(([rows, items]) => { if (alive) { setWaiting(rows); setFeed(items); setNow(Date.now()) } })
    return () => { alive = false }
  }, [tasks])

  const effectiveScope = me ? scope : 'team'
  const groups = buildTodayGroups(tasks, { today, memberId: me?.id, scope: effectiveScope })
  const teamGroups = buildTodayGroups(tasks, { today, memberId: me?.id, scope: 'team' })
  const mineCount = me ? buildTodayGroups(tasks, { today, memberId: me.id, scope: 'mine' }) : null
  const rowProps = { today, members: teamMembers, canOperate, onComplete, onEdit, onArchive }
  const hello = now ? `${greeting(hourInSaoPaulo(now))}${firstName(profile?.name) ? `, ${firstName(profile.name)}` : ''}` : (firstName(profile?.name) ? `Olá, ${firstName(profile.name)}` : 'Olá')

  return <div className="tv">
    <header className="tv-head">
      <div>
        <p className="tv-date">{longDate(today)}</p>
        <h1>{hello}</h1>
        <p className="tv-pulse">
          <span><b>{groups.today.length}</b> para hoje</span>
          {groups.overdue.length > 0 && <span className="late"><b>{groups.overdue.length}</b> atrasada{groups.overdue.length === 1 ? '' : 's'}</span>}
          <button type="button" onClick={() => onNavigate('inbox')}><b>{summary.waitingHuman || 0}</b> conversa{summary.waitingHuman === 1 ? '' : 's'} esperando</button>
          {canAccessFinance && <button type="button" onClick={() => onNavigate('finance-today')}><b>{summary.pendingCharges || 0}</b> cobrança{summary.pendingCharges === 1 ? '' : 's'} em aberto</button>}
        </p>
      </div>
      {canOperate && <div className="tv-actions">
        <button type="button" className="button secondary small" onClick={onQuickHours}><Clock3 size={13} /> Horas</button>
        <button type="button" className="button secondary small" onClick={onQuickDecision}>Anotar decisão</button>
        <button type="button" className="button" onClick={() => onCreate(today)}><Plus size={14} /> Nova tarefa</button>
      </div>}
    </header>

    <nav className="tv-tabs" aria-label="De quem são as tarefas">
      {me && <button type="button" className={effectiveScope === 'mine' ? 'on' : ''} onClick={() => setScope('mine')}>Minhas tarefas <small>{mineCount.overdue.length + mineCount.today.length + mineCount.upcoming.length}</small></button>}
      <button type="button" className={effectiveScope === 'team' ? 'on' : ''} onClick={() => setScope('team')}>Equipe <small>{teamGroups.overdue.length + teamGroups.today.length + teamGroups.upcoming.length}</small></button>
    </nav>

    <div className="tv-grid">
      <div className="tv-list">
        <Group title={groups.overdue.length === 1 ? 'Atrasada' : 'Atrasadas'} tone="late" items={groups.overdue} {...rowProps} />
        <Group title="Hoje" items={groups.today} empty="Nada marcado para hoje." {...rowProps} />
        {canOperate && <button type="button" className="tv-add" onClick={() => onCreate(today)}><Plus size={14} /> Adicionar tarefa <span>— ou mande no WhatsApp da Mugô: “Julia revisar post até 18h”</span></button>}
        <Group title="Próximos 7 dias" items={groups.upcoming} {...rowProps} />
        {groups.undated > 0 && <button type="button" className="tv-undated" onClick={() => onNavigate('operations-backlog')}>{groups.undated} tarefa{groups.undated === 1 ? '' : 's'} sem data →</button>}
      </div>

      <aside className="tv-side">
        <section className="tv-panel">
          <header><MessageCircle size={14} /> Conversas esperando <button type="button" onClick={() => onNavigate('inbox')}>Abrir</button></header>
          {waiting.length ? waiting.map((row) => {
            const name = row.whatsapp_contacts?.display_name || row.whatsapp_contacts?.profile_name || row.whatsapp_contacts?.wa_id || 'Contato'
            return <button type="button" key={row.id} className="tv-wait" onClick={() => onNavigate('inbox')}>
              <span className="tv-av soft">{firstName(name).slice(0, 1).toUpperCase()}</span>
              <span className="who"><b>{name}</b><small>{row.handoff_reason ? String(row.handoff_reason).replaceAll('_', ' ') : 'Aguardando alguém do time'}</small></span>
              <span className="min">{waitingFor(row.last_inbound_at || row.last_message_at, now)}</span>
            </button>
          }) : <p className="tv-empty">Ninguém esperando agora.</p>}
        </section>

        {feed !== null && <section className="tv-panel">
          <header><span className="tv-dot" /> Secretária Mugô <small>últimas 24h</small></header>
          {feed.length ? <ul className="tv-feed">{feed.map((item, index) => {
            const line = describeFeedItem(item)
            return <li key={`${item.at}-${index}`}><time>{timeOf(item.at)}</time><span><b>{line.who}</b> {line.text}</span></li>
          })}</ul> : <p className="tv-empty">Nenhuma mensagem nas últimas 24h.</p>}
        </section>}
      </aside>
    </div>
  </div>
}
