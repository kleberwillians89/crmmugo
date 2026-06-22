function doGet(e) {
  return handleRequest(e)
}

function doPost(e) {
  return handleRequest(e)
}

function handleRequest(e) {
  var requestBody = {}

  if (e.postData && e.postData.type === 'application/json') {
    requestBody = JSON.parse(e.postData.contents)
  } else if (e.parameter && Object.keys(e.parameter).length > 0) {
    requestBody = e.parameter
  }

  var action = requestBody.action
  var result = {}

  try {
    if (action === 'listProposals') {
      result = listProposals()
    } else if (action === 'createProposal') {
      result = createProposal(requestBody.payload)
    } else if (action === 'updateProposal') {
      result = updateProposal(requestBody.id, requestBody.payload)
    } else {
      throw new Error('Ação inválida: ' + action)
    }

    return ContentService.createTextOutput(JSON.stringify({ success: true, data: result }))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeader('Access-Control-Allow-Origin', '*')
      .setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      .setHeader('Access-Control-Allow-Headers', 'Content-Type')
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: error.message }))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeader('Access-Control-Allow-Origin', '*')
      .setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      .setHeader('Access-Control-Allow-Headers', 'Content-Type')
  }
}

function getSheet() {
  // Lê o ID da planilha a partir das propriedades do script
  var spreadsheetId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID')
  if (!spreadsheetId) {
    throw new Error('SPREADSHEET_ID não configurado nas propriedades do Apps Script. Defina em Project Settings -> Script properties.')
  }
  var spreadsheet = SpreadsheetApp.openById(spreadsheetId)
  var sheet = spreadsheet.getSheetByName('proposals')
  if (!sheet) {
    sheet = spreadsheet.insertSheet('proposals')
    sheet.appendRow([
      'id',
      'created_at',
      'updated_at',
      'client_name',
      'company',
      'phone',
      'email',
      'main_service',
      'extra_services',
      'setup_value',
      'monthly_value',
      'proposal_sent_date',
      'responsible',
      'proposal_status',
      'contract_signed',
      'contract_term',
      'contract_start_date',
      'contract_end_date',
      'proposal_file_url',
      'contract_file_url',
      'canva_link',
      'notes',
    ])
  }
  return sheet
}

function formatRow(row, headers) {
  var record = {}
  headers.forEach(function (header, index) {
    var value = row[index]
    if (header === 'contract_signed') {
      record[header] = value === true || value === 'TRUE' || value === 'true' || value === 'Sim' || value === 'sim'
    } else {
      record[header] = value
    }
  })
  return record
}

function listProposals() {
  var sheet = getSheet()
  var data = sheet.getDataRange().getValues()
  if (data.length < 2) {
    return []
  }

  var headers = data[0]
  var rows = data.slice(1)

  return rows.map(function (row) {
    return formatRow(row, headers)
  }).reverse()
}

function createProposal(payload) {
  var sheet = getSheet()
  var now = new Date()
  var id = 'MUGO-' + Utilities.formatDate(now, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyyMMdd-HHmmss')
  var createdAt = Utilities.formatDate(now, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm:ss')
  var updatedAt = createdAt
  var headers = sheet.getDataRange().getValues()[0]
  var row = headers.map(function (header) {
    if (header === 'id') return id
    if (header === 'created_at') return createdAt
    if (header === 'updated_at') return updatedAt
    if (header === 'contract_signed') return payload[header] ? 'TRUE' : 'FALSE'
    return payload[header] || ''
  })

  sheet.appendRow(row)

  return formatRow(row, headers)
}

function updateProposal(id, payload) {
  var sheet = getSheet()
  var data = sheet.getDataRange().getValues()
  if (data.length < 2) {
    throw new Error('Nenhum registro encontrado')
  }

  var headers = data[0]
  var rows = data.slice(1)
  var rowIndex = rows.findIndex(function (row) {
    return row[0] === id
  })

  if (rowIndex === -1) {
    throw new Error('Registro não encontrado: ' + id)
  }

  var sheetRow = rowIndex + 2
  var now = new Date()
  var updatedAt = Utilities.formatDate(now, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm:ss')

  headers.forEach(function (header, index) {
    if (header === 'id' || header === 'created_at') {
      return
    }
    if (header === 'updated_at') {
      sheet.getRange(sheetRow, index + 1).setValue(updatedAt)
      return
    }
    if (payload.hasOwnProperty(header)) {
      var value = payload[header]
      if (header === 'contract_signed') {
        sheet.getRange(sheetRow, index + 1).setValue(value ? 'TRUE' : 'FALSE')
      } else {
        sheet.getRange(sheetRow, index + 1).setValue(value)
      }
    }
  })

  var updatedRow = sheet.getRange(sheetRow, 1, 1, headers.length).getValues()[0]
  return formatRow(updatedRow, headers)
}
