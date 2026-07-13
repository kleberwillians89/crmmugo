# Assistente Pergunte à Mugô

O frontend chama a Edge Function autenticada quando habilitada; a função valida JWT e profile ativo, consulta apenas dados agregados protegidos por RLS e chama a OpenAI Responses API no servidor. A chave usa `OPENAI_API_KEY`, nunca `VITE_`. `OPENAI_MODEL` é obrigatório quando o assistente está habilitado; nenhum nome de modelo é presumido no código.

O contexto exclui documentos, dados pessoais desnecessários e payloads financeiros. Perguntas de mutação são recusadas. Há limites de pergunta, resposta e timeout. Quando desabilitada ou indisponível, a aplicação usa intenções locais determinísticas e não inventa dados.

Publicação: `supabase functions deploy mugo-ai-assistant`. Secrets: `supabase secrets set OPENAI_API_KEY=...`, `supabase secrets set OPENAI_MODEL=...` e `supabase secrets set AI_ASSISTANT_ENABLED=true`. Os valores reais nunca devem entrar no repositório.
