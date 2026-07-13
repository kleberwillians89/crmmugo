# Modelo comercial Mugô

## Metas e receitas

A meta base mensal da equipe é R$ 36.000, dividida em metas individuais de R$ 12.000 para Kleber, Julia e Danilo. Esses valores são parâmetros comerciais locais, não lucro líquido. A receita recorrente soma `monthly_value` apenas de propostas fechadas, assinadas e não vencidas. A receita pontual soma `setup_value` de propostas fechadas e permanece separada.

## Catálogo e cenários

O catálogo local registra categoria, nível, modelo e período de cobrança, descrição e faixas mínima, recomendada e máxima. Os cenários usam somente serviços recorrentes ativos: `ceil(valor restante / preço recomendado)`. São possibilidades simples, não previsões. Itens percentuais sem investimento conhecido e produtos em definição ficam fora dos cálculos.

## Receita contratada

A projeção usa mensalidade, assinatura, status fechado e vigência conhecida. Para cada janela de 30, 90, 180 e 365 dias, considera apenas ciclos mensais aproximados dentro das datas reais. Contratos sem data final contam na receita recorrente atual, mas não são projetados para janelas futuras.

## Limitações e futura persistência

Números dependem da qualidade dos campos atuais, sobretudo status, responsável, assinatura e datas. Datas ou prazos não reconhecíveis são exibidos como não informados e não são inventados. Metas, catálogo, vínculos normalizados de serviço e responsável, tipos de receita e duração contratual deverão migrar futuramente para banco de dados sem alterar o payload legado nesta sprint.
