# Requisitos futuros de dados do CRM

Este documento registra campos recomendados para uma futura evolução da fonte de dados. Nenhum deles foi adicionado ao payload atual nesta sprint.

| Campo | Finalidade | Tipo sugerido | Impacto nos dashboards | Equivalente atual |
| --- | --- | --- | --- | --- |
| `client_id` | Relacionar propostas ao cadastro único de cliente. | `uuid` ou `string` | Evita clientes duplicados e permite visão consolidada por conta. | Não existe; há apenas `client_name`, `company`, `phone` e `email`. |
| `contract_value_total` | Registrar o valor contratual total acordado. | `decimal(14,2)` | Permite receita contratada e ticket total sem estimativas. | Não existe; `setup_value + monthly_value` mostra apenas o valor disponível. |
| `closed_at` | Registrar quando a oportunidade foi efetivamente fechada. | `timestamp` | Viabiliza evolução de vendas e ciclo comercial por período. | Não existe; `proposal_status` informa apenas o estado atual. |
| `lost_at` | Registrar quando a oportunidade foi perdida. | `timestamp` | Permite perdas por mês e tempo até perda. | Não existe. |
| `lost_reason` | Explicar o motivo da perda. | `string` ou enum configurável | Permite análise de objeções e causas de perda. | Pode aparecer informalmente em `notes`, sem estrutura. |
| `next_action` | Descrever o próximo passo comercial. | `string` | Permite fila operacional e propostas que exigem atenção. | Pode aparecer informalmente em `notes`, sem estrutura. |
| `next_action_at` | Definir data e hora do próximo passo. | `timestamp` | Viabiliza agenda, atrasos e alertas comerciais. | Não existe. |
| `probability` | Registrar probabilidade estimada de fechamento. | `decimal(5,2)` | Permite pipeline ponderado. | Não existe e não deve ser inferido pelo status. |
| `contract_start_date` | Registrar o início da vigência. | `date` | Permite contratos ativos por período. | Já existe como campo persistido. |
| `contract_end_date` | Registrar o fim da vigência. | `date` | Permite vencimentos e renovações. | Já existe como campo persistido, mas pode estar vazio. |
| `contract_status` | Representar o ciclo do contrato além de assinado ou não. | enum | Permite separar pendente, ativo, encerrado e cancelado. | Há apenas `contract_signed` e `contract_term`. |
| `renewal_status` | Acompanhar negociação de renovação. | enum | Permite previsão de renovações e risco de churn. | Não existe. |
| `created_at` | Registrar a criação do registro. | `timestamp` | Permite ordenação e volume de oportunidades por período. | Já é gerado pelo Apps Script; registros antigos podem não ter valor confiável. |
| `updated_at` | Registrar a última alteração. | `timestamp` | Permite auditoria de atividade e propostas paradas. | Já é atualizado pelo Apps Script. |

## Outros campos identificados como desejáveis

- `origin`: origem estruturada do lead. Hoje não existe campo persistido.
- `tags`: classificação flexível para segmentação. Hoje não existe campo persistido.
- `proposal_valid_until`: validade formal da proposta. Hoje não existe campo persistido.

Antes de implementar esses campos, a API, a planilha e os registros existentes devem receber uma migração compatível e versionada.
