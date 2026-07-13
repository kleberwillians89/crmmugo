# Arquitetura futura de pagamentos

O provedor ainda não foi definido e nenhuma cobrança real está ativa. Cada criação deverá usar `idempotency_key`; webhooks serão verificados, persistidos uma única vez por `provider + provider_event_id` e processados com reexecução segura. Conciliação compara parcela, cobrança e pagamento, sem confiar somente no webhook.

Estados locais distinguem rascunho, pendente, pago, vencido, cancelado, estornado e falha. Cancelamento e estorno exigem autorização. Nunca registrar segredos; payload bruto deve ter acesso restrito. WhatsApp será acionado somente após estado confirmado e com opt-in, evitando cobrança duplicada ou mensagem prematura.
