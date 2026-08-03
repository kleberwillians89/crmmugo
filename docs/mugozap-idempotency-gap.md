# Lacuna atual de idempotência

## Evidência

O envio manual e o envio por template chamam a Meta antes de existir um registro transacional persistente por `idempotency_key`. O dedupe atual do webhook usa `last_in_msg_id`, protegendo parte da entrada, não a saída.

## Cenários caracterizados

| Cenário | Comportamento atual | Risco |
| --- | --- | --- |
| Mesma chave no envio manual | Chave não é reservada persistentemente | Duas mensagens |
| Mesma chave no template | Chave não é reservada persistentemente | Duas cobranças/templates |
| Timeout Edge → MugoZap | Resultado upstream pode ser desconhecido | Retry duplica |
| Retry do chamador | Nova execução independente | Duplicidade |

Os testes em `server/tests/test_idempotency_characterization.py` são `expectedFailure`. Eles não fazem chamadas externas e documentam o gap sem fingir que a garantia existe.

## Comportamento futuro

Antes da Meta, uma transação deverá criar/reservar uma chave única com escopo `organization_id + connection_id + operation + idempotency_key`. Repetições retornarão o resultado persistido. Estado `unknown` nunca será reenviado automaticamente.

Entidade futura sugerida: `whatsapp_command_executions`, com chave única, hash do request, estado, lease, resposta sanitizada, provider ID mascarado e timestamps. Depende do registry de conexão e de migration da Sprint 1/2.

