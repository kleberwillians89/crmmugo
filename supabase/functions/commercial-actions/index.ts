import {createClient} from 'https://esm.sh/@supabase/supabase-js@2'
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type','Content-Type':'application/json'}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors})
const clean=(value:unknown,max=500)=>String(value??'').trim().slice(0,max)
const date=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())

Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:cors})
  if(request.method!=='POST')return json({ok:false},405)
  const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,authorization=request.headers.get('Authorization')||''
  if(!url||!anon||!service||!authorization)return json({ok:false,code:'UNAUTHORIZED'},401)
  const session=createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}}),user=await session.auth.getUser()
  if(user.error||!user.data.user)return json({ok:false,code:'UNAUTHORIZED'},401)
  const admin=createClient(url,service,{auth:{persistSession:false}}),profile=await admin.from('profiles').select('organization_id,role,active').eq('id',user.data.user.id).single()
  if(profile.error||!profile.data.active||!['admin','manager'].includes(profile.data.role))return json({ok:false,code:'FORBIDDEN'},403)
  const body=await request.json().catch(()=>({})),action=clean(body.action,80),conversationId=clean(body.conversation_id,80),opportunityId=clean(body.opportunity_id,80),org=profile.data.organization_id
  try{
    if(action==='get_context'){
      const [opportunity,settings]=await Promise.all([
        admin.from('commercial_opportunities').select('*,clients(company_name,contact_name,email,phone),team_members(name),commercial_qualifications(*),commercial_briefing_outbox(status,external_url,last_error)').eq('organization_id',org).eq('conversation_id',conversationId).not('stage','in','(won,lost)').maybeSingle(),
        admin.from('commercial_settings').select('commercial_owner_id').eq('organization_id',org).maybeSingle(),
      ])
      if(opportunity.error||settings.error)throw opportunity.error||settings.error
      let owner=null
      if(settings.data?.commercial_owner_id){const result=await admin.from('team_members').select('id,name').eq('id',settings.data.commercial_owner_id).eq('organization_id',org).maybeSingle();if(result.error)throw result.error;owner=result.data}
      return json({ok:true,data:{opportunity:opportunity.data,owner}})
    }
    if(action==='generate_briefing'){
      const opportunity=await admin.from('commercial_opportunities').select('id,stage').eq('id',opportunityId).eq('organization_id',org).single();if(opportunity.error)throw opportunity.error
      if(!['qualified','meeting','proposal','negotiation','won'].includes(opportunity.data.stage))return json({ok:false,code:'OPPORTUNITY_NOT_QUALIFIED',message:'O briefing só pode ser gerado após a qualificação comercial.'},409)
      const queued=await admin.from('commercial_briefing_outbox').upsert({organization_id:org,opportunity_id:opportunity.data.id,idempotency_key:`notion-briefing:${opportunity.data.id}`},{onConflict:'opportunity_id,provider'}).select().single();if(queued.error)throw queued.error
      return json({ok:true,data:queued.data})
    }
    if(action==='handoff'){
      const [conversation,settings]=await Promise.all([
        admin.from('whatsapp_conversations').select('id,connection_id,contact_id,wa_id,whatsapp_contacts(client_id,display_name)').eq('id',conversationId).eq('organization_id',org).single(),
        admin.from('commercial_settings').select('commercial_owner_id').eq('organization_id',org).single(),
      ])
      if(conversation.error||settings.error)throw conversation.error||settings.error
      let ownerProfileId=null
      if(settings.data.commercial_owner_id){const owner=await admin.from('team_members').select('auth_profile_id').eq('id',settings.data.commercial_owner_id).eq('organization_id',org).maybeSingle();if(owner.error)throw owner.error;ownerProfileId=owner.data?.auth_profile_id||null}
      let opportunity=(await admin.from('commercial_opportunities').select('*').eq('organization_id',org).eq('conversation_id',conversationId).not('stage','in','(won,lost)').maybeSingle()).data
      if(!opportunity){
        let clientId=conversation.data.whatsapp_contacts?.client_id
        if(!clientId){
          const candidates=[conversation.data.wa_id,`+${conversation.data.wa_id}`]
          const existing=await admin.from('clients').select('id').eq('organization_id',org).in('phone',candidates).neq('status','archived').limit(1).maybeSingle();if(existing.error)throw existing.error
          if(existing.data?.id)clientId=existing.data.id
          else{const display=conversation.data.whatsapp_contacts?.display_name||`Lead WhatsApp • ${conversation.data.wa_id.slice(-4)}`,created=await admin.from('clients').insert({organization_id:org,company_name:display,contact_name:display,phone:conversation.data.wa_id,lead_source:'WHATSAPP_ORGANIC',status:'lead'}).select('id').single();if(created.error)throw created.error;clientId=created.data.id}
          const linked=await admin.from('whatsapp_contacts').update({client_id:clientId}).eq('id',conversation.data.contact_id).eq('organization_id',org);if(linked.error)throw linked.error
        }
        const created=await admin.from('commercial_opportunities').insert({organization_id:org,client_id:clientId,conversation_id:conversationId,assigned_to:settings.data.commercial_owner_id||null,name:conversation.data.whatsapp_contacts?.display_name||'Lead WhatsApp',stage:'qualifying',source:'WHATSAPP_ORGANIC'}).select().single();if(created.error)throw created.error;opportunity=created.data
      }
      const now=new Date().toISOString()
      const updates=await Promise.all([
        admin.from('commercial_opportunities').update({assigned_to:settings.data.commercial_owner_id||null,stage:'qualified',qualification_reason:'Encaminhamento comercial manual'}).eq('id',opportunity.id).eq('organization_id',org),
        admin.from('whatsapp_conversations').update({status:'pending',attendance_mode:'human',automation_paused:true,assigned_to:ownerProfileId,assigned_team_member_id:settings.data.commercial_owner_id||null,handoff_reason:'manual_commercial_handoff',handoff_at:now,assigned_at:settings.data.commercial_owner_id?now:null}).eq('id',conversationId).eq('organization_id',org),
        admin.from('whatsapp_conversation_events').insert({organization_id:org,connection_id:conversation.data.connection_id,conversation_id:conversationId,event_type:'commercial_handoff',actor_id:user.data.user.id,details:{source:'crm',opportunity_id:opportunity.id}}),
      ]);const failed=updates.find(result=>result.error);if(failed?.error)throw failed.error
      const task=await admin.from('crm_tasks').upsert({organization_id:org,title:`COMERCIAL — Falar com ${conversation.data.whatsapp_contacts?.display_name||opportunity.name}`,status:'pending',priority:'high',due_date:date(),assigned_to:settings.data.commercial_owner_id||null,client_id:opportunity.client_id,opportunity_id:opportunity.id,task_type:'commercial',source:'crm',source_ref:`manual-handoff:${opportunity.id}`,notes:opportunity.conversation_summary||'Handoff comercial manual.',metadata:{origin:'crm',sync_external:true,commercial_handoff:true}},{onConflict:'organization_id,source_ref'});if(task.error)throw task.error
      const notification=await admin.from('commercial_notification_outbox').insert({organization_id:org,opportunity_id:opportunity.id,conversation_id:conversationId,idempotency_key:`commercial-handoff:${opportunity.id}`,payload:{name:conversation.data.whatsapp_contacts?.display_name,company:opportunity.name,interests:opportunity.service_interests,source:opportunity.source,summary:opportunity.conversation_summary,lead_phone:conversation.data.wa_id,next_action:opportunity.next_action}});if(notification.error&&notification.error.code!=='23505')throw notification.error
      return json({ok:true,data:{opportunity_id:opportunity.id}})
    }
    return json({ok:false,code:'INVALID_ACTION'},400)
  }catch(error:any){return json({ok:false,code:clean(error?.code||'ACTION_FAILED',100),message:clean(error?.message)},500)}
})
