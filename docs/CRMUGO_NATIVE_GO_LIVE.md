# CRMugo nativo — preparação para uso diário

## Arquitetura final

O CRMugo e o Supabase são a única fonte da verdade. Rotina, tarefas, calendário, clientes, propostas, documentos, WhatsApp e financeiro funcionam nativamente.

Código histórico de integrações externas pode permanecer no repositório para auditoria, mas não participa do fluxo principal: configurações ficam desabilitadas, o trigger de projeção é removido e filas pendentes são encerradas pela migration de go-live.

## Fonte operacional única

`crm_tasks` alimenta:

- Meu Dia;
- Semana;
- Calendário;
- Backlog;
- Concluídos;
- contexto de cliente, proposta, contrato e oportunidade.

A meta semanal inicial fica em `operational_settings.weekly_target_hours = 35` e poderá ser alterada posteriormente por administrador ou gestor.

A virada usa `organization_settings.operational_start_date = 2026-09-24`. Registros anteriores permanecem consultáveis em Histórico, mas não entram por padrão em Meu Dia, Semana, Calendário ou Backlog.

## WhatsApp interno

O parser diferencia tarefa, início/fim de atividade, decisão, observação, horas, proposta, despesa, recebimento e Caixa Freela. Propostas, anexos e mutações financeiras exigem confirmação e usam chaves idempotentes.

Arquivos são baixados server-side da Meta, limitados a 10 MB, validados por MIME, sanitizados, deduplicados por SHA-256 e gravados no bucket privado existente `crm-documents`. Acesso de visualização e download usa URL assinada.

## Receitas recorrentes

A migration altera somente dias de cobrança confirmados e nunca substitui valores contratuais existentes:

- Origami: dia 05;
- Curavino: dia 05;
- Roove: dia 25;
- CAFIFA / Santo Circuito: dia 15, com alerta administrativo enquanto o contrato ativo permanecer sem `end_date`.

Ruah e Latina ficam em `data_reconciliation_queue` até existir vínculo inequívoco com cliente e contrato. O vínculo Ruah → GIMPORTS SPLITS só pode ser confirmado por administrador e reutiliza o cliente e contrato ativos; nada é criado automaticamente. Latina preserva `currency = EUR` e `original_amount = 100`; câmbio, projeção e valor real permanecem nulos até haver referência financeira real.

O primeiro período financeiro oficial é `organization_settings.financial_start_date = 2026-10-01`. Outubro de 2026 abre por padrão e o saldo permanece “ainda não informado” enquanto não houver `financial_monthly_plans.opening_balance` confirmado.

## Segurança

O Financial Hub aplica permissões e RLS no backend por tenant e escopo. Perfis operacionais não recebem acesso a Casa, dados privados, dívidas pessoais, reservas, bancos ou distribuição.

`access_role_presets.operator` prepara o futuro perfil operacional sem criar usuário e sem conceder acesso automaticamente.

## Dry-run de limpeza

A migration não contém `DELETE` e não executa reset. Para gerar o relatório:

```bash
curl --fail-with-body "$SUPABASE_URL/rest/v1/rpc/crm_cleanup_dry_run" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $ADMIN_ACCESS_TOKEN"
```

Colunas retornadas:

- tabela;
- registros antes;
- preservados;
- candidatos removíveis;
- criados;
- regra aplicada.

Depois da revisão humana, capture o relatório imutável antes de qualquer plano destrutivo:

```bash
curl --fail-with-body -X POST "$SUPABASE_URL/rest/v1/rpc/capture_crm_cleanup_dry_run" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $ADMIN_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Clientes, contratos, parcelas e recebimentos são preservados por padrão. Somente registros explicitamente marcados como demo/teste e sem vínculos financeiros ou documentais podem aparecer como candidatos.

## Sequência exata de produção

1. Fazer backup do banco e do Storage.
2. Confirmar no histórico remoto que `202609220004` e `202609220005` já estão aplicadas.
3. Inspecionar sem aplicar: `supabase db push --linked --dry-run`.
4. Confirmar que o único arquivo pendente esperado é `202609240001_operational_financial_cutover.sql`.
5. Após aprovação humana deste relatório, aplicar com `supabase db push --linked`.
6. Validar o bucket privado `crm-documents`, MIME, limite e políticas de tenant.
7. Executar `crm_cleanup_dry_run()` com sessão administrativa e exportar o resultado; não limpar nada.
8. Capturar o snapshot somente depois da revisão do relatório.
9. Revisar clientes úteis, contratos, parcelas, documentos e candidatos de teste.
10. Revisar CAFIFA e resolver Ruah/Latina manualmente na tela de reconciliação.
11. Executar a atualização idempotente de vencidos e conferir a contagem retornada.
12. Homologar Meu Dia, Semana, Calendário, Backlog e Histórico com perfis admin e operador.
13. Homologar o Financeiro com perfis admin, financeiro e operador, incluindo Casa/Privado.
14. Publicar funções e frontend somente em uma etapa posterior e autorizada.
15. Manter `commercial_settings.ai_mode = 'disabled'` até a homologação final.

Nenhum cliente deve receber mensagem durante a homologação de comandos internos.
