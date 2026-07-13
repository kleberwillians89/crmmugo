export const whatsappProvider={sendInvoice:unavailable,sendDueReminder:unavailable,sendOverdueReminder:unavailable,sendPaymentConfirmation:unavailable}
async function unavailable(){throw new Error('Integração WhatsApp ainda não ativada.')}
