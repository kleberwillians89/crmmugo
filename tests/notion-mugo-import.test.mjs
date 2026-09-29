import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const migration = fs.readFileSync('supabase/migrations/202609240002_notion_mugo_business_import.sql', 'utf8')

function functionBody(source, name) {
  const start = source.indexOf(`function public.${name}`)
  assert.ok(start > -1, `function ${name} not found`)
  const end = source.indexOf('end$$;', start)
  return source.slice(start, end)
}

test('identificador e origem lógica presentes; migration não altera 004/005/240001', () => {
  assert.ok(migration.includes('notion_mugo_import_20260924'))
  assert.equal(fs.existsSync('supabase/migrations/202609220004_structured_proposals_and_documents.sql'), true)
  assert.equal(fs.existsSync('supabase/migrations/202609220005_native_go_live_preparation.sql'), true)
  assert.equal(fs.existsSync('supabase/migrations/202609240001_operational_financial_cutover.sql'), true)
})

test('sem DELETE e sem alterar recebimento/pagamento já confirmado', () => {
  assert.doesNotMatch(migration, /\bdelete\s+from\b/i)
  assert.doesNotMatch(migration, /set\s+(received_amount|paid_at|paid_amount)\s*=/i)
})

test('receitas: só atualiza contrato ativo existente, respeita paid/received/closed, nunca duplica parcela', () => {
  assert.ok(migration.includes("c.status='active'"))
  assert.ok(migration.includes('i.reference_month>=p_cutover'))
  assert.ok(migration.includes("i.status in('draft','pending','overdue')"))
  assert.ok(migration.includes('coalesce(i.received_amount,0)=0'))
  assert.ok(migration.includes('i.paid_at is null'))
  assert.match(migration, /financial_month_closings closing[\s\S]*closing\.status='closed'/)
  assert.doesNotMatch(migration, /insert into public\.invoice_installments/)
  for (const value of ['7000', '3500', '1300', '3200']) assert.ok(migration.includes(value), value)
  assert.ok(migration.includes("'%gimports%'"))
  assert.ok(migration.includes("'%origami%'"))
  assert.ok(migration.includes("'%curavino%'"))
  assert.ok(migration.includes("'%roove%'"))
  // CAFIFA é mencionada apenas no comentário explicando por que não é tocada; nunca em '%cafifa%' como parâmetro real.
  assert.doesNotMatch(migration, /'%cafifa%'/i)
  assert.ok(migration.includes('CAFIFA / Santo Circuito: intencionalmente NÃO tocado'))
})

test('Latina: só enriquece a fila, nunca cria receita nem inventa câmbio', () => {
  assert.match(migration, /recurring:latina[\s\S]*status='pending_mapping'/)
  assert.ok(migration.includes("not(payload ? 'notion_enrichment_source')"))
  assert.ok(migration.includes('2027-02-28'))
  assert.ok(migration.includes('586.12'))
  assert.ok(migration.includes('NÃO usar como valor financeiro definitivo'))
  assert.doesNotMatch(migration, /'actual_brl_amount',\s*5/i)
})

test('despesas: exatamente 8 registros esperados (4 recorrentes + 4 históricos), scope business', () => {
  const count = (migration.match(/insert into public\.expenses\(/g) || []).length
  assert.equal(count, 8)
  for (const name of ["'Liliu'", "'ChatGPT'", "'Claude'", "'Canva'", "'Equipamento / Mac'", "'Ana Maria — lançamento 1'", "'Ana Maria — lançamento 2'", "'Provisão fiscal — histórico'"]) {
    assert.ok(migration.includes(name), name)
  }
  assert.doesNotMatch(migration, /v_org,'Liliu'[\s\S]{0,40}scope='personal'/i)
  assert.match(migration, /v_org,'Liliu'[\s\S]{0,60}'planned',true/)
  assert.match(migration, /'Equipamento \/ Mac'[\s\S]{0,120}'once'/)
  assert.match(migration, /'Ana Maria — lançamento 1'[\s\S]{0,120}'once'/)
  assert.match(migration, /'Provisão fiscal — histórico'[\s\S]{0,120}'once'/)
})

test('caixa freela: exatamente os 4 lançamentos esperados, Ruah não confundida com recurring:ruah', () => {
  const count = (migration.match(/insert into public\.freelance_cash_movements\(/g) || []).length
  assert.equal(count, 4)
  assert.ok(migration.includes("'Ste','income','received',2000"))
  assert.ok(migration.includes("'Tati Tagarela','income','received',800"))
  assert.ok(migration.includes("'Rodrigo Mancusi','income','received',400"))
  assert.ok(migration.includes("'Ruah','income','forecast',2000"))
  assert.doesNotMatch(migration, /reconciliation_key='recurring:ruah'/)
})

test('atividades: exatamente 12 blocos, todos Categoria=Trabalho, sem vínculo automático a cliente', () => {
  const count = (migration.match(/insert into public\.crm_tasks\(/g) || []).length
  assert.equal(count, 12)
  const category = (migration.match(/'Trabalho'/g) || []).length
  assert.ok(category >= 12)
  assert.doesNotMatch(migration, /crm_tasks\([\s\S]{0,400}client_id/i)
  assert.ok(migration.includes("'completed','Trabalho',date '2026-09-21',2.75,2.75"))
  assert.ok(migration.includes("'completed','Trabalho',date '2026-09-21',4.25,4.25"))
  for (const day of ['2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26']) {
    assert.match(migration, new RegExp(`'pending','Trabalho',date '${day}'`))
  }
  assert.doesNotMatch(migration, /'pending','Trabalho'[\s\S]{0,80}\d,\d{2},\d/)
})

test('idempotência: toda linha nova carrega source/source_ref/idempotency_key', () => {
  assert.ok(migration.includes('expenses_source_ref_uidx'))
  // crm_tasks já tem unique(organization_id,source_ref) desde 202609210002; não deve haver índice redundante.
  assert.doesNotMatch(migration, /crm_tasks_source_ref_uidx/)
  assert.ok(migration.includes('commercial_events_source_ref_uidx'))
  for (const ref of [
    'notion:receita:gimports-splits', 'notion:receita:origami-investimentos',
    'notion:receita:curavino', 'notion:receita:roove',
    'notion:despesa:liliu', 'notion:despesa:chatgpt', 'notion:despesa:claude', 'notion:despesa:canva',
    'notion:despesa:equipamento-mac-2026-09', 'notion:despesa:ana-maria-1', 'notion:despesa:ana-maria-2',
    'notion:despesa:provisao-fiscal-2026-09',
    'notion:freela:ste-setembro-2026', 'notion:freela:tati-tagarela-setembro-2026',
    'notion:freela:rodrigo-mancusi-setembro-2026', 'notion:freela:ruah-setembro-2026',
    'notion:work:2026-09-21-bloco-1', 'notion:work:2026-09-26-compensacao',
  ]) assert.ok(migration.includes(ref), ref)
})

test('sem dependência de runtime com Notion: nada de webhook/API/secret/health check', () => {
  assert.doesNotMatch(migration, /notion\.(so|com)/i)
  assert.doesNotMatch(migration, /notion_api_key|notion_token|notion_secret/i)
  assert.doesNotMatch(migration, /http:\/\/|https:\/\//i)
})

test('REGRESSÃO — protect_financial_hub_tenant() não acessa campo inexistente entre tabelas', () => {
  const fn = functionBody(migration, 'protect_financial_hub_tenant')
  assert.ok(fn.includes('to_jsonb(new)'))
  // as três checagens originais continuam presentes com a mesma mensagem de erro
  assert.ok(fn.includes("tg_table_name='financial_permissions'"))
  assert.ok(fn.includes('Financial permission tenant mismatch'))
  assert.ok(fn.includes("tg_table_name='financial_monthly_budgets'"))
  assert.ok(fn.includes('Financial budget tenant mismatch'))
  assert.ok(fn.includes("tg_table_name='freelance_cash_movements'"))
  assert.ok(fn.includes('Freelance cash tenant mismatch'))
  // nenhum acesso direto e inseguro a campo que não existe em todas as tabelas do gatilho
  for (const unsafe of ['new.profile_id', 'new.category_id', 'new.parent_movement_id']) {
    assert.doesNotMatch(fn, new RegExp(unsafe.replace('.', '\\.')))
  }
  // organization_id é comum às três tabelas; acesso direto continua seguro
  assert.ok(fn.includes('new.organization_id'))
})

test('REGRESSÃO — protect_native_operations_tenant() não acessa campo inexistente entre tabelas', () => {
  const fn = functionBody(migration, 'protect_native_operations_tenant')
  assert.ok(fn.includes('to_jsonb(new)'))
  assert.ok(fn.includes("tg_table_name='client_operational_access'"))
  assert.ok(fn.includes('Operational access tenant mismatch'))
  assert.ok(fn.includes("tg_table_name='operational_events'"))
  assert.ok(fn.includes('Operational event tenant mismatch'))
  assert.ok(fn.includes("tg_table_name='financial_command_confirmations'"))
  assert.ok(fn.includes('Financial confirmation tenant mismatch'))
  for (const unsafe of [
    'new.client_id', 'new.team_member_id', 'new.task_id', 'new.opportunity_id',
    'new.conversation_id', 'new.command_event_id', 'new.expense_id',
  ]) {
    assert.doesNotMatch(fn, new RegExp(unsafe.replace('.', '\\.')))
  }
  assert.ok(fn.includes('new.organization_id'))
})

test('funções auxiliares de importação são descartadas ao final (não viram API permanente)', () => {
  assert.ok(migration.includes('drop function if exists public.notion_apply_contract_price_update'))
  assert.ok(migration.includes('drop function if exists public.notion_generate_initial_expense_installment'))
})
