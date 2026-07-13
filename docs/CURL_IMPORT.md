# Importação administrativa por curl

Use uma Edge Function protegida ou ambiente local seguro; nunca coloque service role no navegador. Exemplo conceitual, sem chave real:

```sh
curl -X POST "$ADMIN_EDGE_URL/clients" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"company_name":"Empresa","status":"lead"}'
curl -X POST "$ADMIN_EDGE_URL/proposals" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"client_id":"UUID","title":"Proposta","status":"sent"}'
curl -X PATCH "$ADMIN_EDGE_URL/proposals/UUID/status" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"status":"won"}'
curl -X POST "$ADMIN_EDGE_URL/contracts" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"client_id":"UUID","status":"draft"}'
curl -X POST "$ADMIN_EDGE_URL/installments" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"contract_id":"UUID","amount":1000,"status":"draft"}'
```
