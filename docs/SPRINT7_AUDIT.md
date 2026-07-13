# Auditoria da Sprint 7

Incompatibilidades encontradas e tratadas na migration incremental da Sprint 8:

- importadores usavam `on_conflict` para `organization_id + legacy_id`, mas não havia constraint correspondente;
- parcelas não possuíam campo compatível com observação operacional;
- configurações da organização ainda não tinham tabela própria;
- a política de pagamentos restringia o registro inteiro ao viewer, embora o requisito fosse ocultar somente o payload bruto;
- o frontend legado usa status e nomes de campos em português, enquanto o Supabase usa enums canônicos; repositories passam a ser a fronteira de adaptação;
- não há projeto ou credencial Supabase no ambiente local, portanto RLS, Auth e Storage remotos não podem ser considerados validados.

Não foi criada camada paralela. A migration `202607130002_sprint8_alignment.sql` complementa a fundação existente.
