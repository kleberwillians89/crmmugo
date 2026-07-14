import {performance} from 'node:perf_hooks'
const scenarios=[['clientes',100],['clientes',500],['clientes',1000],['parcelas',5000],['parcelas',10000]]
function run(kind,count){const before=process.memoryUsage().heapUsed;const started=performance.now();const records=Array.from({length:count},(_,i)=>({id:`${kind}-${i}`,amount:kind==='parcelas'?3500:0,status:i%7?'active':'archived'}));const active=records.filter((item)=>item.status==='active');return{cenario:`${count} ${kind}`,tempoMs:Number((performance.now()-started).toFixed(2)),memoriaMB:Number(((process.memoryUsage().heapUsed-before)/1024/1024).toFixed(2)),registros:records.length,renderizacoesSimuladas:active.length,total:active.reduce((sum,item)=>sum+item.amount,0)}}
console.table(scenarios.map(([kind,count])=>run(kind,count)))
