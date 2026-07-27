export const whatsappVisualTemplates=[{
  id:'visual-template-1',
  name:'mugo_pagamento_confirmado',
  display:'Pagamento confirmado',
  category:'UTILITY',
  language:'pt_BR',
  status:'APPROVED',
  is_active:true,
  preview:'Olá, {{1}}. Confirmamos o recebimento do seu pagamento referente aos serviços da Mugô. Agradecemos pela confiança e parceria.',
  components:[{type:'BODY',text:'Olá, {{1}}. Confirmamos o recebimento do seu pagamento referente aos serviços da Mugô. Agradecemos pela confiança e parceria.'}],
},{
  id:'visual-template-2',
  name:'mugo_agendamento_confirmado',
  display:'Agendamento confirmado',
  category:'UTILITY',
  language:'pt_BR',
  status:'APPROVED',
  is_active:true,
  preview:'Olá, {{1}}. Seu atendimento com a equipe da Mugô está confirmado para {{2}}, às {{3}}.',
  components:[{type:'BODY',text:'Olá, {{1}}. Seu atendimento com a equipe da Mugô está confirmado para {{2}}, às {{3}}.'}],
}]

const visualNames=['Cliente Demonstração','Empresa Exemplo','Ana Martins','Bruno Costa','Clínica Horizonte','Daniel Souza','Estúdio Aurora','Fernanda Lima','Grupo Norte','Helena Alves','Instituto Soma','João Ribeiro','Loja Central','Marina Rocha','Núcleo Digital','Otávio Freitas','Projeto Uno','Renata Melo','Studio Vale','Thiago Nunes']
export const whatsappVisualConversations=visualNames.map((name,index)=>({
  id:`visual-conversation-${index+1}`,
  waId:`55119${String(99999605-index).padStart(8,'0')}`,
  phone:`55119${String(99999605-index).padStart(8,'0')}`,
  name,
  preview:index===0?'Obrigado pela confirmação!':index%3===0?'Pode me enviar mais detalhes?':index%3===1?'Aguardando retorno da equipe.':'Combinado, muito obrigado.',
  updatedAt:new Date(Date.UTC(2026,6,27,21,index)).toISOString(),
  unread:index%5===0?2:0,
  status:index%3===0?'customer_replied':'waiting_customer',
  owner:index%2===0?'Atendimento Mugô':'Equipe Comercial',
  attendanceMode:'human',
  botEnabled:false,
  serviceWindowOpen:index!==1,
}))

export const whatsappVisualMessages=[
  {id:'visual-message-1',text:'Olá! Gostaria de confirmar se o pagamento foi identificado.',createdAt:'2026-07-27T18:05:00-03:00',direction:'in',status:'read'},
  {id:'visual-message-1b',text:'Oi',createdAt:'2026-07-27T18:05:20-03:00',direction:'in',status:'read'},
  {id:'visual-message-2',text:'Olá! Já localizamos e estamos concluindo a conferência.',createdAt:'2026-07-27T18:07:00-03:00',direction:'out',status:'read'},
  {id:'visual-message-2b',text:'Perfeito.',createdAt:'2026-07-27T18:07:30-03:00',direction:'in',status:'read'},
  {id:'visual-message-template',text:'Olá, Cliente Demonstração. Confirmamos o recebimento do seu pagamento referente aos serviços da Mugô. Agradecemos pela confiança e parceria. Se precisar de qualquer informação, nossa equipe está à disposição.',template:true,template_name:'mugo_pagamento_confirmado',template_display:'Pagamento confirmado',createdAt:'2026-07-27T18:08:00-03:00',direction:'out',status:'delivered'},
  {id:'visual-message-2c',text:'Certo',createdAt:'2026-07-27T18:08:30-03:00',direction:'in',status:'read'},
  {id:'visual-message-2d',text:'Fico à disposição.',createdAt:'2026-07-27T18:09:00-03:00',direction:'out',status:'read'},
  {id:'visual-message-3',text:'Obrigado pela confirmação!',createdAt:'2026-07-27T18:10:00-03:00',direction:'in',status:'delivered'},
  ...Array.from({length:14},(_,index)=>({id:`visual-message-extra-${index}`,text:index%4===0?'Ok':index%4===1?'Obrigado!':index%4===2?'Vou verificar e retorno por aqui.':'Combinado.',createdAt:new Date(Date.UTC(2026,6,27,21,11+index)).toISOString(),direction:index%2===0?'in':'out',status:'read'})),
]
