#!/usr/bin/env bash
# Publica tudo que a secretária (WhatsApp interno) usa. Rode na pasta do CRM: bash scripts/deploy-secretaria.sh
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
for fn in task-command-worker team-notification-worker whatsapp-webhook; do
  echo "→ publicando $fn"
  npx supabase functions deploy "$fn"
done
echo "✓ secretária publicada"
