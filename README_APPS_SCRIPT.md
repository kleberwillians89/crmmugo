# Integração Google Apps Script — crm.mugoagencia

Este guia descreve como publicar o `apps-script/Code.gs` e configurar a planilha `proposals` para o CRM.

Passos rápidos

1. Crie uma nova Google Spreadsheet (ou use uma existente).
2. Copie o ID da planilha da URL (entre `/d/` e `/edit`).
3. Abra o editor de Apps Script (Extensions → Apps Script) e cole o conteúdo de `apps-script/Code.gs`.
4. No editor do Apps Script: abra **Project settings** → **Script properties** e adicione:
   - `SPREADSHEET_ID` = seu ID da planilha
5. No Apps Script: Deploy → New deployment → Tipo: "Web app" → Acesso: "Anyone" (ou conforme sua política) → Deploy.
6. Copie a URL do Web App e cole em `/.env` como `VITE_GOOGLE_SCRIPT_URL`.
7. No Google Sheets, crie uma aba chamada `proposals` e adicione a primeira linha com os cabeçalhos:

```
id,created_at,updated_at,client_name,company,phone,email,main_service,extra_services,setup_value,monthly_value,proposal_sent_date,responsible,proposal_status,contract_signed,contract_term,contract_start_date,contract_end_date,proposal_file_url,contract_file_url,canva_link,notes
```

8. No frontend do projeto, rode:

```bash
npm install
npm run build
```

Testando a integração

- Abra o CRM localmente (`npm run dev`) ou abra a build e clique em **Dashboard → Testar Conexão**.
- O botão fará um `GET` na URL do Apps Script e mostrará se a conexão foi bem-sucedida. Verifique o console do navegador para ver a resposta completa e a quantidade de registros retornados.

Observações

- O Apps Script usa a propriedade `SPREADSHEET_ID` para localizar a planilha; é recomendado não guardar IDs sensíveis diretamente no código.
- Para automatizar uploads diretos ao Drive, é possível estender `apps-script/Code.gs` para aceitar um arquivo base64, salvar no Drive e retornar a URL; isso será implementado mais tarde.
