# Sprint 14 — Auditoria priorizada

## P0

- Setup novo era contabilizado nas parcelas e novamente pelo acumulador legado do contrato.
- Parcelas de setup entravam em “mensalidades recebidas”.
- Parcelas canceladas com saldo podiam aparecer em “A receber”.
- Payload de edição de cliente podia transportar propriedades retornadas por joins para o `UPDATE`.
- O provider legado retornava sucesso mesmo quando o envio de criação ou edição de proposta falhava na rede.

## P1

- Confirmação de recebimento, setup, conversão e arquivamento de proposta e gravação de cliente não possuíam trava local uniforme contra clique duplo.
- Erros financeiros perdiam `code`, `details`, `hint`, status, operação, entidade e ID.
- Normalização de CNPJ, CPF, telefone e e-mail não era central no repository de clientes.
- Falha ao carregar configurações PIX era ignorada silenciosamente.
- O diagnóstico executava `financial_integrity_diagnostic` duas vezes na mesma ação.

## P2

- Modais podiam ultrapassar a altura útil em telas pequenas.
- Foco visível e estado `disabled` não estavam uniformes.
- Busca de clientes não incluía documento e removia acentos de forma incompleta.
- Alguns estados vazios eram apenas uma célula sem explicação operacional.

## P3 e monitoramento

- Validar no ambiente remoto latência, quantidade de linhas e planos das queries com joins extensos.
- Executar o checklist manual autenticado em todas as larguras antes da liberação.
