// Link público de descadastro (GET mostra a página; POST é o "one-click" do Gmail/Outlook).
// verify_jwt = false. O token é aleatório por contato (email_contacts.unsubscribe_token).
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2'

const page=(title:string,text:string)=>new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:Arial,Helvetica,sans-serif;background:#f4f6f8;color:#101828;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}main{background:#fff;border-radius:12px;padding:32px;max-width:420px;box-shadow:0 8px 24px rgba(16,24,40,.06)}h1{font-size:20px;margin:0 0 8px}p{color:#475467;line-height:1.5;margin:0}</style></head><body><main><h1>${title}</h1><p>${text}</p></main></body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8'}})
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async request=>{
  const token=new URL(request.url).searchParams.get('t')||''
  if(!uuid.test(token))return page('Link inválido','Este link de descadastro não é válido. Se quiser sair da lista, responda qualquer e-mail nosso pedindo a remoção.')
  const admin=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false}})
  const contact=await admin.from('email_contacts').select('id,organization_id,email').eq('unsubscribe_token',token).maybeSingle()
  if(contact.data){
    const now=new Date().toISOString()
    await admin.from('email_contacts').update({subscribed:false,unsubscribed_at:now}).eq('id',contact.data.id)
    await admin.from('email_suppressions').upsert({organization_id:contact.data.organization_id,email:contact.data.email,reason:'unsubscribe'},{onConflict:'organization_id,email'})
  }
  if(request.method==='POST')return new Response('ok')
  return page('Descadastro feito','Pronto — você não vai mais receber nossos e-mails. Se foi engano, é só responder qualquer mensagem nossa.')
})
