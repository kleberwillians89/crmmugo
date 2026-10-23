-- 1) Limpa tarefas de TESTE (atendimento simulado da Roove/leads de teste e tarefa duplicada).
--    Só cancela: nada é apagado. "Reunião com Roove", "Reunião com origami", "Reunião da m2" e "Se conectarem" ficam.
-- 2) Base da IA com a marca da Mugô (do contexto do iAgência) — o atendimento e a prospecção passam a usar.
--    Preços entram DESLIGADOS: ative na tela Base da IA só se quiser que a IA cite faixas.
-- Pode rodar mais de uma vez: não duplica.

with cancelled as (
  update public.crm_tasks set status = 'cancelled'
  where status in ('pending','in_progress')
    and (title like 'COMERCIAL — Falar com Lead WhatsApp%' or title = 'COMERCIAL — Falar com Roove')
  returning title
), duplicate as (
  update public.crm_tasks set status = 'cancelled'
  where id = (select id from public.crm_tasks where title = 'Enviar layout cafifa para Kleber' and status = 'pending' order by created_at desc limit 1)
    and (select count(*) from public.crm_tasks where title = 'Enviar layout cafifa para Kleber' and status = 'pending') > 1
  returning title
)
select 'cancelada' acao, title from cancelled union all select 'duplicada cancelada', title from duplicate;

insert into public.ai_knowledge_entries (organization_id, category, title, content, active, sort_order)
select o.id, k.category, k.title, k.content, k.active, k.sort_order
from public.organizations o
cross join (values
  ('empresa', 'Quem é a Mugô', $t$A Mugô é uma agência criativa e estratégica de São Paulo que une branding, performance digital, automação e IA. Atuamos em publicidade, aplicativos, automação e IA, branding e estratégia de negócios.
Não nos vemos como fornecedores: somos parceiros de crescimento, focados em construir ativos de longo prazo para o cliente.
Atendemos e-commerces, gestoras de investimento e talentos/criadores, além de marcas que querem sair do "feijão com arroz" e crescer com marca forte e resultado mensurável.
A Mugô também vive cultura e lifestyle: música, shows, exposições, teatro e a cena gastronômica de São Paulo fazem parte da nossa identidade.$t$, true, 1),
  ('empresa', 'Pilares da Mugô', $t$1) Parceria de crescimento: sócios estratégicos do sucesso do cliente, não fornecedores.
2) Automação e IA: tecnologia como alavanca de eficiência e escala criativa — tira o braçal para focar no estratégico. A IA não substitui a estratégia nem o olhar humano.
3) Design de elite: a forma serve à função; design que comunica valor, autoridade e sustenta preço premium.
Valores: inovação real, impacto mensurável, design de elite, pensamento disruptivo.$t$, true, 2),
  ('empresa', 'Para quem a Mugô trabalha', $t$Gestores de marketing, heads e CMOs: querem consistência de marca em vários canais, velocidade sem perder qualidade e aprovações sem idas e vindas.
Diretores, C-levels e donos de negócio: querem enxergar resultado e retorno, segurança para delegar a comunicação e clareza de entregas e prazos. Costumam comparar agências só por preço — nosso papel é mostrar valor estratégico.
O que pesa na decisão: confiança nos primeiros contatos, demonstração prática com o contexto real do cliente, onboarding simples, módulos que cabem no momento financeiro e segurança dos dados.$t$, true, 3),
  ('servicos', 'Redes sociais e conteúdo', $t$Gestão de conteúdo mensal: planejamento, copies, artes, calendário e ajustes. Planos do básico (8–12 posts/mês) ao estratégico (conteúdo + análise + ajustes).
Consultoria de redes sociais: diagnóstico pontual ou acompanhamento mensal.$t$, true, 1),
  ('servicos', 'Mídia paga (tráfego pago)', $t$Gestão de anúncios em Meta Ads e Google: da gestão simples à estratégica, com funil, criativos e testes contínuos. Inclui configuração de mensuração (tagueamento/pixel/GA4) quando necessário.$t$, true, 2),
  ('servicos', 'Sites, landing pages, e-commerce e apps', $t$Landing pages (simples ou estratégicas, com copy e funil), sites one page ou completos, e-commerce (Shopify/WooCommerce, básico ou estruturado) e aplicativos (MVP ou robustos).$t$, true, 3),
  ('servicos', 'Automação e IA', $t$Chatbots (FAQ ou integrados a CRM e IA), automações de redes sociais para captar e nutrir leads, agentes de IA sob medida e vídeos/avatares com IA para Reels e anúncios.$t$, true, 4),
  ('servicos', 'Branding, analytics e SEO', $t$Branding e posicionamento de marca, design, auditoria de SEO e analytics (painéis de resultado com Meta, GA4 e e-commerce).$t$, true, 5),
  ('precos', 'Faixas de preço (só se ativado)', $t$Valores sempre confirmados pelo time depois de entender o escopo — a IA só cita a faixa como referência.
Conteúdo para redes: R$ 1.200 a R$ 6.000/mês conforme o plano. Mídia paga: R$ 800 a R$ 3.500/mês de gestão (+ investimento em mídia).
Landing page: R$ 1.500 a R$ 6.000. Site: R$ 2.500 a R$ 12.000. E-commerce: R$ 6.000 a R$ 30.000+. App: a partir de R$ 15.000.
Chatbot/automação: a partir de R$ 1.200. Agente de IA: a partir de R$ 3.000.$t$, false, 1),
  ('regras', 'O que nunca dizer ou prometer', $t$- Nunca prometer resultado financeiro ou retorno garantido.
- Nunca apresentar a IA como substituta da estratégia ou do olhar humano.
- Nunca expor dados, nomes, faturamento ou informações de outros clientes. Cases só com autorização do cliente.
- Nunca passar preço fechado: valores são confirmados pelo time depois de entender o escopo.
- Quando faltar informação, dizer que vai confirmar com o time — nunca inventar.$t$, true, 1),
  ('regras', 'Palavras que a Mugô evita', $t$Evitar: "barato", "promoção", "postzinho", "dicas rápidas", "robô milagroso", "apertar um botão e pronto", "automatização sem critério". Evitar se apresentar como "agência de marketing digital" genérica — a Mugô é estratégica, criativa e de tecnologia.$t$, true, 2),
  ('tom', 'Tom de voz da Mugô', $t$Seguro, humano, estratégico e sofisticado, com um toque de provocação criativa. Mistura linguagem de negócios com criatividade, sem jargão vazio.
No WhatsApp: direto, ágil e cordial — frases curtas, sempre com um próximo passo claro. Sem pressão de venda e sem excesso de emoji.
Toda recomendação deixa claro o objetivo e o próximo passo.$t$, true, 1)
) as k(category, title, content, active, sort_order)
where o.active is not false
  and not exists (select 1 from public.ai_knowledge_entries e where e.organization_id = o.id and e.title = k.title);

select category, title, active from public.ai_knowledge_entries order by category, sort_order;
