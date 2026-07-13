# Segurança Supabase

RLS está ativa em todas as tabelas. Usuário autenticado e ativo lê somente a própria organização; admin escreve tudo no tenant, manager escreve dados comerciais e viewer lê. Profiles e organizações são administrados somente por admin. `organization_id` é validado também no `with check`.

O bucket `crm-documents` é privado, limitado a 10 MB e PDF/DOC/DOCX. Caminhos começam por `{organization_id}/{client_id}/{document_type}` e documentos são abertos por signed URL curta. Payloads financeiros brutos ficam restritos a admin/manager. Anon não recebe policy. Revise policies em staging antes de produção.
