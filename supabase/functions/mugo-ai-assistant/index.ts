import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Content-Type': 'application/json' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers })
  try {
    if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)
    if (Deno.env.get('AI_ASSISTANT_ENABLED') !== 'true') return json({ error: 'Assistente indisponível.' }, 503)
    const model = Deno.env.get('OPENAI_MODEL')
    if (!model || !Deno.env.get('OPENAI_API_KEY')) return json({ error: 'Assistente sem configuração.' }, 503)
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Sessão necessária.' }, 401)
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
    const { data: { user } } = await client.auth.getUser()
    if (!user) return json({ error: 'Sessão inválida.' }, 401)
    const { data: profile } = await client.from('profiles').select('organization_id,active').eq('id', user.id).single()
    if (!profile?.active) return json({ error: 'Usuário sem acesso ativo.' }, 403)
    const { question } = await request.json()
    if (typeof question !== 'string' || question.length < 2 || question.length > 500) return json({ error: 'Pergunta inválida.' }, 400)
    if (/criar|alterar|excluir|enviar|marcar|ativar|importar/i.test(question)) return json({ answer: 'Posso orientar você, mas nesta versão não realizo alterações no CRM.', sources: ['Política consultiva'] })
    const [clients, proposals, contracts, installments] = await Promise.all([
      client.from('clients').select('status'), client.from('proposals').select('status,sent_at,closed_at,lost_at,total_value,setup_value,monthly_value,responsible'), client.from('contracts').select('status,signed,end_date,monthly_value,setup_value'), client.from('invoice_installments').select('status,amount,due_date'),
    ])
    const context = { clients: clients.data || [], proposals: proposals.data || [], contracts: contracts.data || [], installments: installments.data || [] }
    const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, max_output_tokens: 500, input: [{ role: 'system', content: 'Você é o assistente consultivo do CRM Mugô. Responda em português usando apenas o contexto agregado. Não execute mutações. Informe as fontes internas.' }, { role: 'user', content: `Pergunta: ${question}\nContexto: ${JSON.stringify(context)}` }] }) })
    if (!response.ok) return json({ error: 'O assistente está temporariamente indisponível.' }, 502)
    const body = await response.json(); const answer = body.output?.flatMap((item: any) => item.content || []).find((item: any) => item.type === 'output_text')?.text || 'Não foi possível gerar uma resposta segura.'
    return json({ answer, sources: ['Clientes', 'Propostas', 'Contratos', 'Parcelas'] })
  } catch { return json({ error: 'O assistente está temporariamente indisponível.' }, 500) }
})
