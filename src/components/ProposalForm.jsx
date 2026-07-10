import { useEffect, useMemo, useRef, useState } from 'react'
import { BriefcaseBusiness, Building2, ClipboardCheck, FileText, MessageSquareText, Save, ShieldCheck, UserRound, WalletCards } from 'lucide-react'
import { FeedbackMessage } from './FeedbackMessage'
import { PageHeader } from './PageHeader'
import { ContractBadge, ProposalStatusBadge } from './ProposalStatusBadge'

const responsibilities = ['Kleber', 'Julia', 'Danilo']
const proposalStatuses = ['Proposta enviada', 'Em negociação', 'Fechada', 'Perdida']
const contractTerms = ['Sem contrato', '3 meses', '6 meses', '12 meses', 'Indeterminado']
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const phonePattern = /^[\d\s()+-]{8,20}$/

function validUrl(value) {
  if (!value) return true
  try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false }
}

function money(value) {
  const number = Number(value)
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number.isFinite(number) ? number : 0)
}

function Field({ label, name, required, help, error, warning, children }) {
  const describedBy = [help && `${name}-help`, error && `${name}-error`, warning && `${name}-warning`].filter(Boolean).join(' ') || undefined
  return <div className="form-field">
    <label htmlFor={name}>{label}{required && <span aria-hidden="true">*</span>}</label>
    {children({ id: name, name, 'aria-invalid': Boolean(error), 'aria-describedby': describedBy })}
    {help && <small id={`${name}-help`} className="field-help">{help}</small>}
    {error && <small id={`${name}-error`} className="field-message error">{error}</small>}
    {!error && warning && <small id={`${name}-warning`} className="field-message warning">{warning}</small>}
  </div>
}

function FormSection({ icon: Icon, title, description, children }) {
  return <section className="form-section"><header><div className="form-section-icon"><Icon size={18} /></div><div><h2>{title}</h2><p>{description}</p></div></header><div className="form-section-grid">{children}</div></section>
}

export function ProposalForm({ form, onChange, onSubmit, onCancel, loading, errors, message, editMode, onDirtyChange }) {
  const [initialSnapshot] = useState(() => JSON.stringify(form))
  const formRef = useRef(null)
  const dirty = JSON.stringify(form) !== initialSnapshot

  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])
  useEffect(() => {
    if (!dirty) return undefined
    const warn = (event) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const validation = useMemo(() => {
    const result = {}
    if (!form.client_name.trim()) result.client_name = 'Nome do cliente é obrigatório.'
    if (!form.main_service.trim()) result.main_service = 'Serviço principal é obrigatório.'
    if (!form.proposal_status) result.proposal_status = 'Status da proposta é obrigatório.'
    if (!form.responsible) result.responsible = 'Responsável é obrigatório.'
    if (form.setup_value === '' && form.monthly_value === '') result.setup_value = 'Informe o valor de implantação ou a mensalidade.'
    if (form.email && !emailPattern.test(form.email)) result.email = 'Informe um e-mail válido.'
    if (form.phone && !phonePattern.test(form.phone)) result.phone = 'Use apenas números, espaços, parênteses, + ou hífen.'
    ;['proposal_file_url', 'contract_file_url', 'canva_link'].forEach((name) => { if (!validUrl(form[name])) result[name] = 'Informe uma URL completa iniciada por http:// ou https://.' })
    ;['setup_value', 'monthly_value'].forEach((name) => { if (form[name] !== '' && !Number.isFinite(Number(form[name]))) result[name] = 'Informe um valor numérico válido.' })
    if (form.contract_start_date && form.contract_end_date && form.contract_end_date < form.contract_start_date) result.contract_end_date = 'A data final não pode ser anterior à data inicial.'
    return result
  }, [form])

  const warnings = useMemo(() => ({
    responsible: !form.responsible ? 'Defina um responsável para facilitar o acompanhamento.' : '',
    contract_signed: form.proposal_status === 'Fechada' && !form.contract_signed ? 'A proposta está fechada, mas o contrato ainda consta como pendente.' : '',
    contract_file_url: form.contract_signed && !form.contract_file_url ? 'Contrato assinado sem link do documento.' : '',
    contract_end_date: form.contract_term !== 'Sem contrato' && !form.contract_end_date ? 'Contrato sem data final informada.' : '',
  }), [form])

  const completionFields = ['client_name', 'company', 'phone', 'email', 'main_service', 'setup_value', 'monthly_value', 'proposal_sent_date', 'responsible', 'proposal_status', 'contract_term']
  const completed = completionFields.filter((name) => form[name] !== '' && form[name] !== null).length
  const completion = Math.round((completed / completionFields.length) * 100)
  const totalAvailable = (Number(form.setup_value) || 0) + (Number(form.monthly_value) || 0)

  function submit(event) {
    event.preventDefault()
    const firstError = Object.keys(validation)[0]
    if (firstError) { formRef.current?.elements[firstError]?.focus(); return }
    onSubmit(event)
  }

  const bind = (name) => ({ value: form[name], onChange })

  return <div className="proposal-form-page">
    <PageHeader eyebrow={editMode ? 'Editar proposta' : 'Nova proposta'} title={editMode ? 'Atualizar proposta' : 'Cadastrar proposta'} description="Organize os dados comerciais com clareza e acompanhe o que ainda precisa ser preenchido." actions={<button type="button" className="button secondary" onClick={onCancel}>Voltar</button>} />
    {message && <FeedbackMessage>{message}</FeedbackMessage>}{errors && <FeedbackMessage type="error">{errors}</FeedbackMessage>}
    <form ref={formRef} className="proposal-form-layout" onSubmit={submit} noValidate>
      <div className="proposal-form-sections">
        <FormSection icon={UserRound} title="Cliente" description="Dados de contato e identificação da oportunidade.">
          <Field label="Nome do cliente" name="client_name" required error={validation.client_name} help="Nome da pessoa responsável pelo contato.">{(props) => <input {...props} {...bind('client_name')} autoComplete="name" placeholder="Ex.: Mariana Costa" required />}</Field>
          <Field label="Empresa" name="company" help="Nome comercial ou razão social.">{(props) => <input {...props} {...bind('company')} autoComplete="organization" placeholder="Ex.: Empresa Acme" />}</Field>
          <Field label="Telefone" name="phone" error={validation.phone} help="O valor será mantido como digitado.">{(props) => <input {...props} {...bind('phone')} type="tel" inputMode="tel" autoComplete="tel" placeholder="(11) 99999-9999" />}</Field>
          <Field label="E-mail" name="email" error={validation.email}>{(props) => <input {...props} {...bind('email')} type="email" inputMode="email" autoComplete="email" placeholder="contato@empresa.com" />}</Field>
        </FormSection>

        <FormSection icon={BriefcaseBusiness} title="Serviço e escopo" description="Defina o que está sendo vendido e o escopo complementar.">
          <Field label="Serviço principal" name="main_service" required error={validation.main_service} help="Este campo alimenta os relatórios e rankings.">{(props) => <input {...props} {...bind('main_service')} placeholder="Ex.: Gestão de mídia paga" required />}</Field>
          <Field label="Prazo contratual" name="contract_term">{(props) => <select {...props} {...bind('contract_term')}>{contractTerms.map((term) => <option key={term}>{term}</option>)}</select>}</Field>
          <Field label="Serviços adicionais" name="extra_services" help="Itens opcionais incluídos na proposta.">{(props) => <input {...props} {...bind('extra_services')} placeholder="Ex.: Landing page e automação" />}</Field>
        </FormSection>

        <FormSection icon={WalletCards} title="Valores" description="Implantação e mensalidade são valores distintos.">
          <Field label="Valor de implantação" name="setup_value" error={validation.setup_value} help="Cobrança única de início do projeto.">{(props) => <div className="money-input"><span>R$</span><input {...props} {...bind('setup_value')} type="number" inputMode="decimal" min="0" step="0.01" placeholder="0,00" /></div>}</Field>
          <Field label="Valor mensal" name="monthly_value" error={validation.monthly_value} help="Cobrança recorrente mensal.">{(props) => <div className="money-input"><span>R$</span><input {...props} {...bind('monthly_value')} type="number" inputMode="decimal" min="0" step="0.01" placeholder="0,00" /></div>}</Field>
          <div className="value-preview full-width"><div><span>Implantação</span><strong>{money(form.setup_value)}</strong></div><div><span>Mensalidade</span><strong>{money(form.monthly_value)}</strong></div><div className="total"><span>Valor disponível da proposta</span><strong>{money(totalAvailable)}</strong><small>Implantação + uma mensalidade, sem projeção contratual.</small></div></div>
        </FormSection>

        <FormSection icon={FileText} title="Proposta comercial" description="Status, envio e documentos da negociação.">
          <Field label="Status da proposta" name="proposal_status" required error={validation.proposal_status}>{(props) => <select {...props} {...bind('proposal_status')} required><option value="">Selecione</option>{proposalStatuses.map((status) => <option key={status}>{status}</option>)}</select>}</Field>
          <Field label="Data de envio" name="proposal_sent_date">{(props) => <input {...props} {...bind('proposal_sent_date')} type="date" />}</Field>
          <Field label="Link da proposta" name="proposal_file_url" error={validation.proposal_file_url}>{(props) => <input {...props} {...bind('proposal_file_url')} type="url" inputMode="url" placeholder="https://..." />}</Field>
          <Field label="Link do orçamento no Canva" name="canva_link" error={validation.canva_link}>{(props) => <input {...props} {...bind('canva_link')} type="url" inputMode="url" placeholder="https://www.canva.com/..." />}</Field>
        </FormSection>

        <FormSection icon={ClipboardCheck} title="Contrato" description="Situação, documento e período contratual.">
          <Field label="Contrato assinado" name="contract_signed" warning={warnings.contract_signed}>{(props) => <select {...props} value={form.contract_signed ? 'true' : 'false'} onChange={onChange}><option value="false">Não</option><option value="true">Sim</option></select>}</Field>
          <Field label="Link do contrato" name="contract_file_url" error={validation.contract_file_url} warning={warnings.contract_file_url}>{(props) => <input {...props} {...bind('contract_file_url')} type="url" inputMode="url" placeholder="https://drive.google.com/..." />}</Field>
          <Field label="Data de início" name="contract_start_date">{(props) => <input {...props} {...bind('contract_start_date')} type="date" />}</Field>
          <Field label="Data de término" name="contract_end_date" error={validation.contract_end_date} warning={warnings.contract_end_date}>{(props) => <input {...props} {...bind('contract_end_date')} type="date" />}</Field>
        </FormSection>

        <FormSection icon={ShieldCheck} title="Gestão interna" description="Responsabilidade e acompanhamento pela equipe Mugô.">
          <Field label="Responsável" name="responsible" required error={validation.responsible} warning={warnings.responsible}>{(props) => <select {...props} {...bind('responsible')} required><option value="">Selecione</option>{responsibilities.map((value) => <option key={value}>{value}</option>)}</select>}</Field>
          <div className="internal-note"><Building2 size={17} /><p>O status comercial é controlado na seção “Proposta comercial” e também pode ser atualizado no Pipeline.</p></div>
        </FormSection>

        <FormSection icon={MessageSquareText} title="Observações" description="Contexto interno, combinados e informações relevantes.">
          <Field label="Observações" name="notes" help={`${form.notes.length} caracteres — sem limite artificial.`}>{(props) => <textarea {...props} {...bind('notes')} rows="7" placeholder="Registre aqui detalhes da negociação, necessidades e combinados..." />}</Field>
        </FormSection>
      </div>

      <aside className="proposal-form-summary">
        <div className="summary-card"><header><div><p>Resumo da proposta</p><h2>{form.company || form.client_name || 'Nova oportunidade'}</h2></div><ClipboardCheck size={19} /></header><dl><div><dt>Cliente</dt><dd>{form.client_name || 'Não informado'}</dd></div><div><dt>Serviço</dt><dd>{form.main_service || 'Não informado'}</dd></div><div><dt>Responsável</dt><dd>{form.responsible || 'Não informado'}</dd></div><div><dt>Status</dt><dd><ProposalStatusBadge status={form.proposal_status} /></dd></div><div><dt>Implantação</dt><dd>{money(form.setup_value)}</dd></div><div><dt>Mensalidade</dt><dd>{money(form.monthly_value)}</dd></div><div><dt>Contrato</dt><dd><ContractBadge signed={form.contract_signed} /></dd></div></dl><div className="completion"><div><span>Completude do cadastro</span><strong>{completion}%</strong></div><div className="completion-track"><span style={{ width: `${completion}%` }} /></div><small>Indicação visual; não é salva na proposta.</small></div></div>
        <div className="form-action-bar"><button type="button" className="button secondary" onClick={onCancel}>Cancelar</button><button type="submit" className="button" disabled={loading}><Save size={15} />{loading ? 'Salvando...' : editMode ? 'Atualizar proposta' : 'Salvar proposta'}</button>{dirty && <small>Alterações ainda não salvas.</small>}</div>
      </aside>
    </form>
  </div>
}
