#!/usr/bin/env bash
# Publica prospecção e newsletter. Rode na pasta do CRM: bash scripts/deploy-crescimento.sh
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
for fn in prospecting newsletter; do
  echo "→ publicando $fn"
  npx supabase functions deploy "$fn"
done
echo "✓ prospecção e newsletter publicadas"
