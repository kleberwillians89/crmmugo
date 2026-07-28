# Rollback da projeção

Primeira ação:

```env
WHATSAPP_CONNECTION_PROJECTION_ENABLED=false
WHATSAPP_CONNECTION_OUTBOX_WORKER_ENABLED=false
WHATSAPP_CONNECTION_RECONCILIATION_ENABLED=false
MUGOZAP_BUILD_INFO_ENABLED=false
```

Depois:

1. interromper processo/cron do worker;
2. preservar outbox, registry e projection events para auditoria;
3. manter V1 como fonte efetiva;
4. reverter deploy do MugoZap para commit anterior, se necessário;
5. não apagar tabelas como primeira medida;
6. remover apenas fixtures identificadas e autorizadas, depois de exportar evidência;
7. rotacionar HMAC nos dois lados se houver suspeita de exposição;
8. nunca rotacionar token Meta por causa deste canal, salvo evidência independente.

Eventos `processing` presos devem ser revisados antes de voltar a `failed`/`pending`; não reenviar respostas ambíguas sem confirmar o ledger.
