import { db, isSupabaseProvider, unwrap } from './provider'

export async function listIntelligenceRecords() {
  if (!isSupabaseProvider()) return { documents: [], events: [], documentAnalyses: [] }
  const [documents, events, analyses] = await Promise.all([
    db().from('documents').select('id,client_id,proposal_id,contract_id,document_type,file_name,uploaded_at'),
    db().from('commercial_events').select('id,client_id,proposal_id,contract_id,event_type,title,description,created_at').order('created_at', { ascending: false }).limit(250),
    db().from('document_analyses').select('id,file_name,document_type,status,overall_confidence,field_count,low_confidence_fields,missing_fields,confirmed_document_id,created_at').order('created_at', { ascending: false }).limit(250),
  ])
  return { documents: unwrap(documents), events: unwrap(events), documentAnalyses: unwrap(analyses) }
}
