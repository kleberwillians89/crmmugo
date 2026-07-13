import { unavailablePaymentProvider } from './paymentProvider'
const development=import.meta.env.DEV
const guard=()=>{if(!development)return unavailablePaymentProvider()}
export const mockPaymentProvider={createCharge:async(input)=>{guard();return {id:`mock-${crypto.randomUUID()}`,status:'pending',input}},getCharge:async(id)=>{guard();return {id,status:'pending'}},cancelCharge:async(id)=>{guard();return {id,status:'cancelled'}},refundCharge:async(id)=>{guard();return {id,status:'refunded'}},parseWebhook:async(payload)=>{guard();return payload},verifyWebhookSignature:async()=>{guard();return true}}
