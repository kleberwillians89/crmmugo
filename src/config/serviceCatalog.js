// Catálogo local temporário; será migrado futuramente para banco de dados.
const service = (id, category, name, level, billingType, minimumPrice, recommendedPrice, maximumPrice, billingPeriod, description) => ({ id, category, name, level, billingType, minimumPrice, recommendedPrice, maximumPrice, billingPeriod, description, active: true })

export const SERVICE_CATALOG = [
  service('social-basico','Redes sociais','Social Media Básico','Básico','recurring',1200,1600,2000,'monthly','8 a 12 posts por mês.'),
  service('social-intermediario','Redes sociais','Social Media Intermediário','Intermediário','recurring',2000,2750,3500,'monthly','12 a 20 posts por mês.'),
  service('social-estrategico','Redes sociais','Social Media Estratégico','Estratégico','recurring',3500,4750,6000,'monthly','Conteúdo, análise e ajustes.'),
  service('midia-simples','Mídia paga','Gestão de Mídia Simples','Básico','recurring',800,1150,1500,'monthly','Gestão recorrente de mídia paga.'),
  service('midia-estrategica','Mídia paga','Gestão de Mídia Estratégica','Estratégico','recurring',1500,2500,3500,'monthly','Funil, criativos e testes.'),
  service('midia-percentual','Mídia paga','Percentual sobre mídia','Variável','percentage',10,15,20,'percentage_of_media','Percentual do investimento; depende do valor de mídia.'),
  service('diagnostico-redes','Consultoria','Diagnóstico de Redes Sociais','Diagnóstico','project',1200,2100,3000,'one_time','Diagnóstico pontual de redes sociais.'),
  service('consultoria-mensal','Consultoria','Consultoria Mensal de Redes Sociais','Estratégico','recurring',2000,3500,5000,'monthly','Consultoria recorrente de redes sociais.'),
  service('imagens-simples','Criação de imagens','Pacote Simples de Imagens','Básico','project',500,850,1200,'one_time','10 a 20 imagens.'),
  service('imagens-estrategico','Criação de imagens','Pacote Estratégico de Imagens','Estratégico','project',1500,2500,3500,'one_time','Branding ou campanha.'),
  service('video-curto','Criação de vídeos','Vídeo Curto','Unitário','unit',300,550,800,'per_video','Reels ou Ads; valor por vídeo.'),
  service('videos-mensal','Criação de vídeos','Pacote Mensal de Vídeos','Recorrente','recurring',1500,2750,4000,'monthly','4 a 8 vídeos por mês.'),
  service('avatar-simples','Inteligência Artificial — Avatares','Avatar Simples','Básico','project',1500,2250,3000,'one_time','Imagem e voz; entrega inicial de duas frases.'),
  service('avatar-avancado','Inteligência Artificial — Avatares','Avatar Avançado','Avançado','project',4000,7000,10000,'one_time','Produção recorrente de vídeo; modelo inicial por projeto.'),
  service('jingle-simples','Jingles','Jingle Simples','Básico','project',500,850,1200,'one_time','Criação de jingle simples.'),
  service('jingle-identidade','Jingles','Jingle com Identidade Sonora','Estratégico','project',1500,2500,3500,'one_time','Músicos e IA.'),
  service('app-mvp','Aplicativos','MVP de Aplicativo','MVP','project',15000,22500,30000,'one_time','Aplicativo em escopo MVP.'),
  service('app-robusto','Aplicativos','Aplicativo Robusto','Avançado','project',30000,55000,80000,'one_time','Aplicativo robusto sob escopo.'),
  service('lp-conversao','Landing pages','Landing Page de Conversão','Básico','project',1500,2250,3000,'one_time','Landing page focada em conversão.'),
  service('lp-estrategica','Landing pages','Landing Page Estratégica','Estratégico','project',3000,4500,6000,'one_time','Copy e funil.'),
  service('ecommerce-basico','E-commerce','E-commerce Básico','Básico','project',6000,9000,12000,'one_time','Shopify ou WooCommerce.'),
  service('ecommerce-estruturado','E-commerce','E-commerce Estruturado','Estratégico','project',12000,21000,30000,'one_time','Pagamentos e automações.'),
  service('site-one-page','Sites institucionais','Site One Page','Básico','project',2500,3750,5000,'one_time','Site institucional de uma página.'),
  service('site-completo','Sites institucionais','Site Institucional Completo','Completo','project',5000,8500,12000,'one_time','5 a 8 páginas.'),
  service('chatbot-simples','Chatbots','Chatbot Simples','Básico','project',1500,2250,3000,'one_time','FAQ.'),
  service('chatbot-integrado','Chatbots','Chatbot Integrado','Avançado','project',4000,7000,10000,'one_time','WhatsApp, site ou Instagram com CRM e IA.'),
  service('fluxo-basico','Automações','Fluxo Básico','Básico','project',1200,2100,3000,'one_time','Automação de fluxo básico.'),
  service('automacao-estrategica','Automações','Automação Estratégica','Estratégico','project',3000,5500,8000,'one_time','Leads e funil.'),
  service('agente-simples','Agentes de IA','Agente Simples','Básico','project',3000,5000,7000,'one_time','Atendimento ou conteúdo.'),
  service('agente-avancado','Agentes de IA','Agente Avançado','Avançado','project',8000,16500,25000,'one_time','Dados, vendas e integrações.'),
]

export const PRODUCTS_IN_DEFINITION = ['I.Agência', 'Mugô Metrics', 'CRM Mugô']
