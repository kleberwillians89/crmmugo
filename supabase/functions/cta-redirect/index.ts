// Redireciona o botão "Falar com …" para o WhatsApp da equipe e registra o clique (usado no reenvio).
// verify_jwt = false: é aberto pelo celular do lead. Só lê/atualiza o link pelo id.
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2'

const FALLBACK='https://mugoagencia.com.br'
const redirect=(location:string)=>new Response(null,{status:302,headers:{Location:location,'Cache-Control':'no-store'}})

Deno.serve(async request=>{
  const id=new URL(request.url).searchParams.get('l')||''
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return redirect(FALLBACK)
  const admin=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false}})
  const link=await admin.from('whatsapp_cta_links').select('id,target_url,click_count,clicked_at').eq('id',id).maybeSingle()
  if(link.error||!link.data||!/^https:\/\//i.test(link.data.target_url))return redirect(FALLBACK)
  await admin.from('whatsapp_cta_links').update({click_count:Number(link.data.click_count||0)+1,clicked_at:link.data.clicked_at||new Date().toISOString()}).eq('id',id)
  return redirect(link.data.target_url)
})
