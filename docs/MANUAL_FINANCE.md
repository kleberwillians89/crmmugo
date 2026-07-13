# Financeiro manual

Parcelas são criadas manualmente por admin ou manager e não acionam gateway, PIX ou WhatsApp. Alterações geram `commercial_events` com usuário, estado anterior e novo. Marcar como paga, cancelar ou estornar exige confirmação; estorno é exclusivo de admin.

Receita prevista representa parcelas registradas, recebida representa status pago, pendente representa status pendente e vencida representa status overdue. Esses valores não são proposta enviada nem MRR contratado.
