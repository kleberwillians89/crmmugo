# Configuração Supabase

1. Crie o projeto. Copie somente URL e publishable key.
2. Crie `.env.local` a partir de `.env.example`; mantenha `VITE_DATA_PROVIDER=legacy` durante a preparação.
3. Execute as migrations com Supabase CLI ou SQL Editor.
4. Em Auth, desative cadastro público e crie o primeiro usuário manualmente.
5. Consulte o UUID da organização `mugo` e insira o `profile` do usuário com role `admin`.
6. Confirme que o bucket `crm-documents` é privado e que as policies foram publicadas.
7. Teste login e roles admin, manager e viewer. Depois teste clientes, propostas, contratos, documentos e parcelas.
8. Na Vercel, configure URL, publishable key, provider e slug. Nunca use service role, secret key ou senha do banco no frontend.
9. Teste primeiro `legacy`, depois `supabase`. Para voltar, defina `VITE_DATA_PROVIDER=legacy` e publique novamente.

Sem credenciais, o build legado continua funcionando; o modo Supabase apresenta erro controlado.

Após aplicar as migrations, use o Diagnóstico Supabase administrativo para validar organização, profile, coleções, bucket, signed URL e RLS sem realizar escrita.
