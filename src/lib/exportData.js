const scalar=(value)=>value==null?'':typeof value==='object'?JSON.stringify(value):String(value)
const rowsOf=(data)=>Array.isArray(data)?data:[data]
const columnsOf=(rows)=>[...new Set(rows.flatMap((row)=>Object.keys(row||{})))]
const quote=(value)=>`"${scalar(value).replaceAll('"','""')}"`
export function serializeExport(data,format){
  if(format==='json')return{content:JSON.stringify(data,null,2),mime:'application/json',extension:'json'}
  const rows=rowsOf(data),columns=columnsOf(rows)
  if(format==='csv')return{content:[columns.map(quote).join(','),...rows.map((row)=>columns.map((key)=>quote(row?.[key])).join(','))].join('\n'),mime:'text/csv;charset=utf-8',extension:'csv'}
  const escape=(value)=>scalar(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
  const table=`<table><thead><tr>${columns.map((key)=>`<th>${escape(key)}</th>`).join('')}</tr></thead><tbody>${rows.map((row)=>`<tr>${columns.map((key)=>`<td>${escape(row?.[key])}</td>`).join('')}</tr>`).join('')}</tbody></table>`
  return{content:`<!doctype html><meta charset="utf-8">${table}`,mime:'application/vnd.ms-excel;charset=utf-8',extension:'xls'}
}
export function downloadExport(data,format,name){const file=serializeExport(data,format);const url=URL.createObjectURL(new Blob(['\ufeff',file.content],{type:file.mime}));const anchor=document.createElement('a');anchor.href=url;anchor.download=`${name}-${new Date().toISOString().slice(0,10)}.${file.extension}`;anchor.click();URL.revokeObjectURL(url)}
