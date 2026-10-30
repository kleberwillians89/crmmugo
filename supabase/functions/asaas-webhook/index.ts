// Webhook do Asaas: dá baixa na parcela quando a cobrança é paga (multa e juros inclusos).
// Configure no Asaas: URL .../functions/v1/asaas-webhook, eventos PAYMENT_RECEIVED e PAYMENT_CONFIRMED,
// token de autenticação = secret ASAAS_WEBHOOK_TOKEN (enviado pelo Asaas no header asaas-access-token).
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2'
import {asaasConfigFromEnv,handleAsaasWebhookEvent} from '../_shared/asaasCore.js'

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}})

function sameSecret(a:string,b:string){
  if(!a||!b||a.length!==b.length)return false
  let diff=0
  for(let i=0;i<a.length;i+=1)diff|=a.charCodeAt(i)^b.charCodeAt(i)
  return diff===0
}

Deno.serve(async request=>{
  if(request.method!=='POST')return json({ok:false},405)
  const expected=Deno.env.get('ASAAS_WEBHOOK_TOKEN')||''
  if(!sameSecret(request.headers.get('asaas-access-token')||'',expected))return json({ok:false,code:'UNAUTHORIZED'},401)
  const url=Deno.env.get('SUPABASE_URL')||'',service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
  if(!url||!service)return json({ok:false,code:'CONFIGURATION_MISSING'},503)
  const body=await request.json().catch(()=>null)
  if(!body)return json({ok:false,code:'INVALID_JSON'},400)
  try{
    const admin=createClient(url,service,{auth:{persistSession:false}})
    const result=await handleAsaasWebhookEvent({admin,body,config:asaasConfigFromEnv((name:string)=>Deno.env.get(name)||'')})
    return json({ok:true,...result})
  }catch(error){
    // Erro devolve 500 para o Asaas tentar de novo (o evento falho pode ser reprocessado).
    console.log(JSON.stringify({event:'asaas_webhook_failed',asaas_event:body?.event,payment_id:body?.payment?.id,error:String((error as any)?.message||'').slice(0,300)}))
    return json({ok:false,code:'PROCESSING_FAILED'},500)
  }
})
