# Estabilização WhatsApp para demonstração

Status: alterações locais, sem deploy e sem migrations aplicadas.

## Causas confirmadas

- O cliente Supabase consumia URL/chave sem sanitização; newline na variável chegava ao WebSocket como `%0A`.
- Histórico e lista usavam fallback em 5 e 15 segundos.
- A subscription era recriada ao trocar a conversa.
- O painel executava `sync_templates` automaticamente após `list_templates`.
- A Edge local possui `sync_templates`; o 404 publicado indica versão implantada divergente ou falha fora do mapa local.
- Edge tinha timeout, mas não retry limitado/circuit breaker e o envelope não incluía duração em todas as respostas.

## Correções locais

- Configuração pública sanitizada, validada e compartilhada pelo singleton.
- Polling mínimo de 30 segundos, 60 segundos quando Realtime está online, sem chamadas com aba invisível.
- Canal Realtime único por montagem, cleanup explícito e estados visíveis.
- Sync Meta somente manual e bloqueado em modo demonstração.
- Aliases `get_conversation_messages` e `send_template`; operação `health_check`.
- Envelope inclui `code`, `message`, `request_id` e `duration_ms`.
- Reads upstream têm no máximo dois retries com backoff; circuit breaker abre após falhas consecutivas.
- Validação local de template monta preview sanitizado sem chamada à Meta.
- Banner e bloqueios de demonstração impedem mensagens e mutações.
- Telas locais de Automações, IA e Status não possuem executor externo.

## Preparação, não ativação

`202607280004_whatsapp_automation_ai_foundation.sql` contém tabelas iniciais com RLS forçada e sem acesso frontend. Ela exige revisão específica antes de aplicação. Não há executor de automações nem integração de modelo de IA.

## Checklist de deploy

1. Revisar e remover whitespace das variáveis Vercel sem imprimir valores.
2. Comparar a Edge implantada com `supabase/functions/mugozap-api/index.ts`.
3. Confirmar flags de envio false e `VITE_WHATSAPP_DEMO_MODE=true`.
4. Executar todas as suites e build.
5. Publicar frontend separadamente da Edge.
6. Validar Realtime sem `%0A` e intervalos pela aba Network.
7. Publicar Edge somente após revisão de diff e rollback.
8. Não aplicar a migration de automações/IA neste deploy de apresentação.
