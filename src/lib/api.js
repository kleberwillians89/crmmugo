const API_URL = import.meta.env.VITE_GOOGLE_SCRIPT_URL

console.log('API URL:', API_URL)

async function request(payload, method = 'POST') {
  if (!API_URL) {
    throw new Error('VITE_GOOGLE_SCRIPT_URL não está configurado')
  }

  let response
  try {
    if (method === 'GET') {
      response = await fetch(API_URL, { method: 'GET' })
    } else {
      response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
    }
  } catch (err) {
    throw new Error('Falha de conexão: ' + (err.message || err))
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Erro na API: ${response.status} ${body}`)
  }

  let data
  try {
    data = await response.json()
  } catch (err) {
    throw new Error('Resposta inválida da API: não é JSON')
  }

  if (!data || typeof data !== 'object') {
    throw new Error('Resposta inválida da API')
  }

  if (data.success === false) {
    throw new Error(data.error || 'Erro desconhecido da API')
  }

  return data
}

export async function getProposals() {
  const result = await request({ action: 'listProposals' })
  return Array.isArray(result.data) ? result.data : []
}

export async function createProposal(payload) {
  const result = await request({ action: 'createProposal', payload })
  return result.data
}

export async function updateProposal(id, payload) {
  const result = await request({ action: 'updateProposal', id, payload })
  return result.data
}
