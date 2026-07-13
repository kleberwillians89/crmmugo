export const paymentProviderMethods=['createCharge','getCharge','cancelCharge','refundCharge','parseWebhook','verifyWebhookSignature']
export function unavailablePaymentProvider(){throw new Error('Cobrança automática ainda não ativada.')}
