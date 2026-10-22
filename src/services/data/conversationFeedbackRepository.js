import {db,organizationId,unwrap} from './provider'

export const CONVERSATION_FEEDBACK_LABELS={correct:'Correto',partially_correct:'Parcialmente correto',incorrect:'Incorreto',intent_wrong:'Intenção errada',entity_wrong:'Entidade errada',context_wrong:'Contexto errado',response_poor:'Resposta ruim',tool_wrong:'Ferramenta errada'}
export async function recordConversationFeedback({conversationId,label,note,sourceKind=null,sourceEventId=null,expectedOutcome={}}){
  if(!CONVERSATION_FEEDBACK_LABELS[label])throw new Error('Escolha uma avaliação válida.')
  return unwrap(await db().from('conversation_feedback').insert({organization_id:await organizationId(),conversation_id:conversationId,label,note:String(note||'').slice(0,2000),source_kind:sourceKind,source_event_id:sourceEventId,expected_outcome:expectedOutcome}).select('id').single())
}
