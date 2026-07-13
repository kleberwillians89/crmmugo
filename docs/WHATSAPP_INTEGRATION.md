# Integração futura com WhatsApp

Nesta sprint existe apenas a interface, sem endpoint, token ou envio. A API existente deverá fornecer autenticação server-side, identificador do destinatário, template aprovado, locale, idempotência, status de entrega e correlação com parcela/pagamento.

Fluxos previstos: envio de cobrança, lembrete de vencimento, lembrete de atraso e confirmação de pagamento. Cada disparo deverá respeitar consentimento, horário, auditoria e deduplicação. O frontend nunca receberá token do WhatsApp.
