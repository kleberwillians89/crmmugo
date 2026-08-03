# ADR-011 — armazenamento de conexões WhatsApp

Status: armazenamento confirmado; canal de projeção detalhado no ADR-012; rollout bloqueado  
Data: 2026-07-28

## Contexto

O CRM possui a identidade comercial por organização. O MugoZap executa mensagens e webhooks por workspace. A Sprint 1.1 confirmou projetos Supabase separados, e duplicar configuração editável em ambos criaria divergência e risco cross-tenant.

## Opções

- A — somente CRM: boa governança, mas webhook/worker dependeriam do control-plane a cada evento.
- B — somente MugoZap: reduz latência operacional, mas retira do CRM a origem administrativa.
- C — origem canônica no CRM e projeção operacional no MugoZap.

## Decisão

Adotar C:

- `whatsapp_connections` canônica no Supabase CRM;
- UUID criado no CRM e imutável;
- registry operacional read-only no MugoZap;
- projeção idempotente pelo mesmo UUID;
- nenhuma edição independente no execution-plane;
- credentials permanecem em provedor de secrets e são referenciadas opacamente.

## Responsabilidades

| Ação | Responsável |
| --- | --- |
| Criar/atualizar conexão | CRM/control-plane, após autorização de negócio |
| Armazenar configuração canônica | Supabase CRM |
| Projetar registro operacional | Serviço interno autenticado, contrato ainda pendente |
| Resolver webhook por phone ID | Registry MugoZap |
| Resolver credencial | `CredentialProvider` interno |
| Exibir conexão | View/RPC sanitizada do CRM |

## Indisponibilidade e reconciliação

O MugoZap usa a última projeção válida, com versão/timestamp. Falha do control-plane não autoriza fallback para outro tenant. Conexão ausente, duplicada ou incompatível falha de forma segura nos fluxos V2. Em shadow, V1 continua e a divergência é registrada.

A reconciliação futura compara UUID, campos não secretos, versão e `updated_at`; o CRM vence conflitos. O execution-plane nunca promove alteração local para canônica.

## Webhook

O webhook extrai `metadata.phone_number_id`, consulta o registry local e obtém `organization_id`, `workspace_id` e `connection_id`. Nesta sprint isso é somente shadow; o tenant efetivo V1 não muda.

## Consequências e riscos

- Requer canal seguro de projeção entre projetos.
- Introduz consistência eventual.
- Registry desatualizado deve ser observável e nunca usar default silencioso.
- Rotação de credential_reference exige reconciliação.
- Rollback desliga V2 e mantém tabela/projeção sem uso.
