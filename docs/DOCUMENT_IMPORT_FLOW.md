# Importação de documentos

Propostas e contratos devem seguir: selecionar ou criar cliente, preencher dados explícitos, adicionar serviços, anexar PDF/DOC/DOCX, revisar a prévia e confirmar. A persistência deve criar registro, serviços, documento e evento comercial; falha posterior ao upload exige exclusão compensatória.

Antes de salvar, comparar cliente, número, `legacy_id`, nome, tamanho, tipo e datas. Informação ausente permanece ausente; não inferir status, datas ou valores. Importar proposta não cria contrato. Importar contrato não ativa o contrato nem cria parcela. O fluxo atual ainda não possui todas essas etapas na interface e deve ser concluído antes de uma importação histórica real.
