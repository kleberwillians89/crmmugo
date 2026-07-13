# Modelo de dados Supabase

`organizations` isola tenants. `profiles` liga Auth a organização e role. `clients` centraliza contas; `proposals` e `proposal_services` representam venda; `contracts` e `contract_services`, receita contratada; `documents`, metadados privados; `invoice_installments`, `payments` e `payment_events`, fundação financeira; `commercial_events`, trilha comercial sem agenda.

Todas as tabelas operacionais usam UUID e `organization_id`. Propostas mantêm setup, mensalidade e total separados. Contratos não ficam ativos automaticamente. A migration não importa dados legados.

Sprint 8 adiciona `organization_settings`, observação operacional nas parcelas, constraints idempotentes para `legacy_id` e uma visão financeira sem payload bruto.
