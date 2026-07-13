# Importação financeira manual preparada

Esta função aceita somente registros revisados de contrato ou mensalidade. Ela não lê PDFs, não usa OCR, não confirma PIX e respeita a sessão, o papel e o RLS do operador.

Campos de contrato aceitos nesta sprint incluem `setup_value`, `setup_received_amount`, `setup_received_at`, `setup_payment_method` e `setup_payment_notes`.

Campos de mensalidade aceitos incluem `status`, `paid_at`, `payment_method` e `manual_confirmation_at`.

Exemplo de contrato, sem dados reais:

```bash
curl -X POST "$SUPABASE_URL/functions/v1/manual-commercial-import" \
  -H "Authorization: Bearer $USER_ACCESS_TOKEN" \
  -H "apikey: $SUPABASE_PUBLISHABLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":"contract","record":{"client_id":"CLIENT_UUID","setup_value":0,"setup_received_amount":0}}'
```

Exemplo de mensalidade, sem dados reais:

```bash
curl -X POST "$SUPABASE_URL/functions/v1/manual-commercial-import" \
  -H "Authorization: Bearer $USER_ACCESS_TOKEN" \
  -H "apikey: $SUPABASE_PUBLISHABLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":"installment","record":{"client_id":"CLIENT_UUID","contract_id":"CONTRACT_UUID","reference_month":"YYYY-MM-01","installment_number":1,"due_date":"YYYY-MM-DD","amount":0,"status":"pending"}}'
```
