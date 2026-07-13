import assert from 'node:assert/strict'
import {normalizeProposal} from '../src/lib/normalizeProposal.js'
const proposal=normalizeProposal({id:'akana',title:'Proposta Akanã',status:'sent',setup_value:'2500',monthly_value:'1800',responsible:'Klebs',clients:{company_name:'Akanã',trade_name:'Akanã',contact_name:'Ana',email:'financeiro@akana.test'},proposal_services:[{id:'service',service_name:'Gestão de mídia',service_category:'Marketing',monthly_value:'1800',one_time_value:'2500'}],documents:[{id:'document',document_type:'proposal',file_name:'proposta-akana.pdf',uploaded_at:'2026-07-13'}]})
assert.equal(proposal.clientName,'Akanã')
assert.equal(proposal.companyName,'Akanã')
assert.equal(proposal.contactName,'Ana')
assert.equal(proposal.mainService,'Gestão de mídia')
assert.equal(proposal.responsibleName,'Klebs')
assert.equal(proposal.services[0].monthlyValue,1800)
assert.equal(proposal.proposalFile.file_name,'proposta-akana.pdf')
