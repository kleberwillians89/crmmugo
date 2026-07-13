import { db, isSupabaseProvider, unwrap } from './provider'

export async function listIntelligenceRecords() {
  if (!isSupabaseProvider()) return { documents: [], events: [] }
  const [documents, events] = await Promise.all([
    db().from('documents').select('id,client_id,proposal_id,contract_id,document_type,file_name,uploaded_at'),
    db().from('commercial_events').select('id,client_id,proposal_id,contract_id,event_type,title,description,created_at').order('created_at', { ascending: false }).limit(250),
  ])
  return { documents: unwrap(documents), events: unwrap(events) }
}
