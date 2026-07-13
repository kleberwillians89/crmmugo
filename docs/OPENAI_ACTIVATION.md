# Ativação da Mugô Intelligence com OpenAI

A aplicação usa os motores locais primeiro. A OpenAI só é consultada pela Supabase Edge Function quando a pergunta não possui resposta local confiável. O frontend nunca acessa a chave da OpenAI.

## 1. Configurar secrets no Supabase

```bash
supabase secrets set OPENAI_API_KEY="SUA_CHAVE"
supabase secrets set OPENAI_MODEL="MODELO_ESCOLHIDO"
supabase secrets set AI_ASSISTANT_ENABLED="true"
```

`OPENAI_MODEL` é obrigatório e não possui valor padrão no código. Não use nomes iniciados por `VITE_` para chaves, modelos ou tokens privados.

## 2. Publicar a função

```bash
supabase functions deploy mugo-ai-assistant
```

Não utilize `--no-verify-jwt`. A função valida a sessão novamente, busca o profile ativo e deriva `organization_id` no servidor.

## 3. Ativar o provider no frontend

Configure no Vercel somente:

```text
VITE_AI_PROVIDER=supabase
```

Faça um novo deploy do Vercel e entre novamente no CRM. Nunca configure `OPENAI_API_KEY`, `VITE_OPENAI_API_KEY`, service role, access token ou refresh token no Vercel.

## 4. Validar

1. Entre como administrador.
2. Abra Diagnóstico Supabase.
3. Execute o diagnóstico geral.
4. Clique em Testar Mugô Intelligence.
5. Confirme a resposta segura de conexão.
6. Teste uma pergunta local e outra analítica.
7. Desative temporariamente `AI_ASSISTANT_ENABLED` para validar o fallback local e reative em seguida.

A função envia à Responses API somente agregações comerciais e dados mínimos necessários. Não envia documentos, payloads brutos, e-mails, telefones, tokens ou observações pessoais extensas.
