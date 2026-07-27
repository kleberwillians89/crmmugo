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
}]

export const whatsappVisualConversations=[
  {id:'visual-conversation-1',waId:'5511999999605',phone:'5511999999605',name:'Cliente Demonstração',preview:'Obrigado pela confirmação!',updatedAt:'2026-07-27T18:10:00-03:00',unread:2,status:'customer_replied',owner:'Atendimento Mugô',attendanceMode:'human',botEnabled:false,serviceWindowOpen:true},
  {id:'visual-conversation-2',waId:'5511988888504',phone:'5511988888504',name:'Empresa Exemplo',preview:'Podemos remarcar para amanhã?',updatedAt:'2026-07-27T17:42:00-03:00',unread:0,status:'waiting_customer',owner:'Equipe Comercial',attendanceMode:'human',botEnabled:false,serviceWindowOpen:false},
]

export const whatsappVisualMessages=[
  {id:'visual-message-1',text:'Olá! Gostaria de confirmar se o pagamento foi identificado.',createdAt:'2026-07-27T18:05:00-03:00',direction:'in',status:'read'},
  {id:'visual-message-2',text:'Olá! Já localizamos e estamos concluindo a conferência.',createdAt:'2026-07-27T18:07:00-03:00',direction:'out',status:'read'},
  {id:'visual-message-3',text:'Obrigado pela confirmação!',createdAt:'2026-07-27T18:10:00-03:00',direction:'in',status:'delivered'},
]
