import assert from 'node:assert/strict'
import { confirmationsForDocument,humanizeTechnicalValue,monthlyValueComposition } from '../src/lib/commercialDocumentReview.js'

const field=(value,valueOrigin='explicit')=>({value,confidence:.9,sourceExcerpt:'Trecho de teste sem dados pessoais.',needsReview:false,valueOrigin})
const akana={client:{company_name:field('Akanã'),segment:field('Hospitalidade de luxo'),contact_name:field(null,'missing'),email:field(null,'missing'),phone:field(null,'missing')},proposal:{proposal_number:field(null,'missing'),sent_at:field(null,'missing'),valid_until:field(null,'missing'),setup_value:field(4000),monthly_value:field(7000,'calculated')},services:[
  {service_name:field('Onboarding'),billing_type:field('one_time'),one_time_value:field(4000),monthly_value:field(null,'missing')},
  {service_name:field('Presença Digital'),billing_type:field('monthly'),monthly_value:field(4000)},
  {service_name:field('Mídia Paga + ajustes no site'),billing_type:field('monthly'),monthly_value:field(1500)},
  {service_name:field('Branding e Ativações'),billing_type:field('monthly'),monthly_value:field(1500)},
  {service_name:field('Dashboard'),billing_type:field('included'),monthly_value:field(null,'missing')},
]}

const composition=monthlyValueComposition(akana)
assert.equal(akana.client.company_name.value,'Akanã')
assert.equal(akana.client.segment.value,'Hospitalidade de luxo')
assert.equal(akana.proposal.setup_value.value,4000)
assert.equal(akana.services.length,5)
assert.deepEqual(['proposal_number','sent_at','valid_until'].filter((key)=>akana.proposal[key].value==null),['proposal_number','sent_at','valid_until'])
assert.equal(composition.calculated,7000)
assert.equal(composition.services.length,3)
assert.deepEqual(confirmationsForDocument('proposal').map(([key])=>key),['values','status','dates','services'])
assert.equal(confirmationsForDocument('proposal').some(([key])=>['signature','financial','renewal'].includes(key)),false)
assert.deepEqual(confirmationsForDocument('signed_contract').map(([key])=>key),['values','dates','signature','status','financial','renewal'])
assert.deepEqual(confirmationsForDocument('unsigned_contract').map(([key])=>key),['values','dates','signature','status','financial','renewal'])
assert.deepEqual(confirmationsForDocument('amendment').map(([key])=>key),['values','dates','services','contract_link'])
assert.deepEqual(confirmationsForDocument('other').map(([key])=>key),['client','document_type'])
assert.equal(humanizeTechnicalValue('one_time'),'Pagamento único')
assert.equal(humanizeTechnicalValue('included'),'Incluso')
console.info('Regressão documental Akanã: aprovada.')
