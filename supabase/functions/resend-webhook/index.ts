// Eventos do Resend (entregue, aberto, clicado, bounce, spam) → status do destinatário e supressões.
// Secret: RESEND_WEBHOOK_SECRET (whsec_...). verify_jwt = false (assinatura Svix própria).
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2'
import {RESEND_STATUS,shouldAdvanceRecipient,verifySvixSignature} from '../_shared/emailMarketingCore.js'

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}})

Deno.serve(async request=>{
  if(request.method!=='POST')return json({ok:false},405)
  const raw=await request.text()
  const valid=await verifySvixSignature({secret:Deno.env.get('RESEND_WEBHOOK_SECRET')||'',id:request.headers.get('svix-id')||'',timestamp:request.headers.get('svix-timestamp')||'',signature:request.headers.get('svix-signature')||'',body:raw})
  if(!valid)return json({ok:false,code:'INVALID_SIGNATURE'},401)
  const event=JSON.parse(raw||'{}'),next=RESEND_STATUS[event?.type as keyof typeof RESEND_STATUS],emailId=String(event?.data?.email_id||'')
  if(!next||!emailId)return json({ok:true,ignored:true})
  const admin=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false}})
  const recipient=await admin.from('email_campaign_recipients').select('id,organization_id,email,status,contact_id').eq('resend_id',emailId).maybeSingle()
  if(!recipient.data)return json({ok:true,unknown:true})
  const at=event?.created_at||new Date().toISOString()
  if(shouldAdvanceRecipient(recipient.data.status,next)){
    const patch:any={status:next}
    if(next==='delivered')patch.delivered_at=at
    if(next==='opened')patch.opened_at=at
    if(next==='clicked'){patch.clicked_at=at}
    await admin.from('email_campaign_recipients').update(patch).eq('id',recipient.data.id)
  }
  if(next==='bounced'||next==='complained'){
    await admin.from('email_suppressions').upsert({organization_id:recipient.data.organization_id,email:recipient.data.email,reason:next==='bounced'?'bounce':'complaint'},{onConflict:'organization_id,email'})
    if(recipient.data.contact_id)await admin.from('email_contacts').update({subscribed:false,unsubscribed_at:at}).eq('id',recipient.data.contact_id)
  }
  return json({ok:true})
})
