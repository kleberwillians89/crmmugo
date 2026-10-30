#!/usr/bin/env bash
# Publica a ponte CRM <-> Mugô Dados. Rode na pasta do CRM: bash scripts/deploy-dados-ops.sh
# Antes, uma vez (ou pelo painel: Edge Functions -> Secrets):
#   npx supabase secrets set DADOS_OPS_API_KEY=<a mesma chave do Render do Mugô Dados>
#   npx supabase secrets set DADOS_HOOK_URL=https://mugo-dados.onrender.com/api/hooks/crm
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
npx supabase functions deploy dados-ops-api --no-verify-jwt     # leitura: tarefas e conversas
npx supabase functions deploy dados-ops-events --no-verify-jwt  # escrita: tarefa + aviso ao time
npx supabase functions deploy whatsapp-webhook                  # clique Sim/Não do convite volta para o Dados
npx supabase functions deploy team-notification-worker          # texto do aviso de falha
echo "✓ ponte com o Mugô Dados publicada"
