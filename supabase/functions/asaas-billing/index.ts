// Gera (ou atualiza) a cobrança do Asaas de uma parcela e devolve o link de pagamento.
// Chamado pela tela (usuário admin/manager logado). Multa e juros vêm das configurações da empresa.
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2'
import {AsaasError,asaasConfigFromEnv,ensureAsaasCharge} from '../_shared/asaasCore.js'

const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors})
const clean=(value:unknown,max=500)=>String(value??'').trim().slice(0,max)

Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:cors})
  if(request.method!=='POST')return json({ok:false,code:'METHOD_NOT_ALLOWED'},405)
  const url=Deno.env.get('SUPABASE_URL')||'',anon=Deno.env.get('SUPABASE_ANON_KEY')||'',service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',authorization=request.headers.get('Authorization')||''
  if(!url||!anon||!service)return json({ok:false,code:'CONFIGURATION_MISSING',message:'Configuração interna incompleta.'},503)
  if(!authorization)return json({ok:false,code:'UNAUTHORIZED',message:'Entre novamente no CRM.'},401)
  const session=createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}}),user=await session.auth.getUser()
  if(user.error||!user.data.user)return json({ok:false,code:'UNAUTHORIZED',message:'Sua sessão expirou. Entre novamente no CRM.'},401)
  const admin=createClient(url,service,{auth:{persistSession:false}})
  const profile=await admin.from('profiles').select('organization_id,role,active').eq('id',user.data.user.id).single()
  if(profile.error||!profile.data?.active||!['admin','manager'].includes(profile.data.role))return json({ok:false,code:'FORBIDDEN',message:'Só admin ou gestor gera cobrança no Asaas.'},403)
  const body=await request.json().catch(()=>({}))
  const action=clean(body.action,40)||'create_charge',installmentId=clean(body.installment_id,80)
  if(action!=='create_charge'||!installmentId)return json({ok:false,code:'INVALID_REQUEST',message:'Informe a parcela.'},400)
  try{
    const config=asaasConfigFromEnv((name:string)=>Deno.env.get(name)||'')
    const amount:any=body.amount==null||body.amount===''?null:Number(body.amount)
    const data=await ensureAsaasCharge({admin,org:profile.data.organization_id,installmentId,amount,reason:clean(body.reason,300),actorId:user.data.user.id,config})
    return json({ok:true,data})
  }catch(error){
    if(error instanceof AsaasError)return json({ok:false,code:error.code,message:error.message},error.status)
    console.log(JSON.stringify({event:'asaas_billing_failed',installment_id:installmentId,error:clean((error as any)?.message)}))
    return json({ok:false,code:'ASAAS_BILLING_FAILED',message:'Não foi possível gerar a cobrança no Asaas.'},500)
  }
})
