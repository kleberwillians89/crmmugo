const API_URL = import.meta.env.VITE_GOOGLE_SCRIPT_URL

function wait(ms) {
  return new Promise((res) => setTimeout(res, ms))
}

async function ensureApiUrl() {
  if (!API_URL) {
    throw new Error('VITE_GOOGLE_SCRIPT_URL não está configurado')
  }
}

export async function getProposals() {
  await ensureApiUrl()

  let response
  try {
    response = await fetch(API_URL, { method: 'GET' })
  } catch (err) {
    throw new Error('Falha de conexão: ' + (err.message || err), { cause: err })
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Erro na API: ${response.status} ${body}`)
  }

  let data
  try {
    data = await response.json()
  } catch (err) {
    throw new Error('Resposta inválida da API: não é JSON', { cause: err })
  }

  return Array.isArray(data.data) ? data.data : []
}

export async function createProposal(data) {
  await ensureApiUrl()

  try {
    // enviar como text/plain para evitar problemas com Apps Script e permitir no-cors
    await fetch(API_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify({ action: 'create', data }),
    })
  } catch (err) {
    throw new Error(`Não foi possível enviar a proposta: ${err?.message||'falha de rede.'}`,{cause:err})
  }

  // não é possível ler resposta em no-cors; aguardar e retornar sucesso
  await wait(800)
  return { success: true }
}

export async function updateProposal(id, data) {
  await ensureApiUrl()

  try {
    await fetch(API_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify({ action: 'update', id, data }),
    })
  } catch (err) {
    throw new Error(`Não foi possível atualizar a proposta: ${err?.message||'falha de rede.'}`,{cause:err})
  }

  await wait(800)
  return { success: true }
}
