# Extração comercial assistida

## Preparação

Aplicar a migration `202607130004_sprint10_5_document_extraction.sql`. Ela cria o staging privado `crm-documents-temp`, limitado a 20 MB, e a tabela protegida `document_analyses`.

Os secrets permanecem somente no Supabase:

```bash
supabase secrets set OPENAI_API_KEY="SUA_CHAVE"
supabase secrets set OPENAI_MODEL="MODELO_COM_STRUCTURED_OUTPUTS"
supabase secrets set AI_ASSISTANT_ENABLED="true"
```

`OPENAI_MODEL` não possui fallback no código. O modelo configurado precisa oferecer Structured Outputs na Responses API.

## Publicação

```bash
supabase functions deploy extract-commercial-document
```

Não use `--no-verify-jwt`. A função valida novamente a sessão, o profile ativo, a organização e os papéis `admin` ou `manager`.

## Fluxo

1. O navegador envia PDF, DOC ou DOCX para um caminho temporário privado da organização e do usuário.
2. A Edge Function baixa o arquivo pela sessão autenticada, extrai apenas o texto necessário e solicita JSON aderente a schema rígido.
3. O resultado permanece em revisão. Nenhum cliente, proposta, contrato, serviço, parcela ou pagamento é criado nessa etapa.
4. O usuário edita campos, resolve duplicidades e confirma explicitamente status, valores, datas, assinatura, recebimento, cobrança e total.
5. Após a confirmação, o arquivo é copiado ao bucket definitivo e os registros são criados. Em falha, os registros parciais e o arquivo definitivo são compensados.
6. O arquivo temporário é removido após confirmação ou cancelamento.

Arquivos expirados são removidos de forma oportunista na próxima análise do usuário. Para ambientes com baixa frequência de uso, agende uma rotina administrativa que remova objetos expirados e execute `expire_document_analyses()` para limpar os metadados.

## Limitações

- Não há OCR externo nesta sprint. PDFs sem texto pesquisável retornam o aviso de documento digitalizado.
- DOC legado depende da extração textual disponível no arquivo; layouts complexos podem exigir revisão adicional.
- Cláusulas e dados financeiros extraídos ficam na análise para revisão, mas não geram parcelas nem confirmam recebimentos.
- Aditivos precisam ser vinculados a um contrato existente.
- A função não envia documentos completos, tokens ou payloads financeiros à interface e não grava o texto integral em logs ou auditoria.
