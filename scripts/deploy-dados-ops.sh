#!/usr/bin/env bash
# Publica a ponte operacional CRM -> Mugô Dados (tarefas e atendimento, somente leitura).
# Rode na pasta do CRM: bash scripts/deploy-dados-ops.sh
# Antes, uma vez: npx supabase secrets set DADOS_OPS_API_KEY=<a mesma chave configurada no Render do Mugô Dados>
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
npx supabase functions deploy dados-ops-api --no-verify-jwt
echo "✓ dados-ops-api publicada"
