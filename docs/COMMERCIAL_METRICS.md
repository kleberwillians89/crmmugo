# Métricas comerciais

O período usa `sent_at`. Registros sem data ficam fora de filtros temporais e são contados separadamente. Valor proposto usa `total_value`; quando ausente, soma setup e mensalidade. Conversão por desfecho é `won / (won + lost)` e conversão sobre enviadas é `won / status diferente de draft`.

Tempo de fechamento usa `closed_at - sent_at`; tempo até perda usa `lost_at - sent_at`. Datas inválidas e diferenças negativas são excluídas. Serviço vem de `proposal_services`, com fallback legado. Responsável e origem ausentes aparecem explicitamente.
