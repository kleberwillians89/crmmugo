const corporateTerms=/\b(ltda|limitada|me|mei|epp|sa|s a|ss|holding|servicos|servico)\b/g
export const digits=(value)=>String(value||'').replace(/\D/g,'')
export const normalizeEmail=(value)=>String(value||'').trim().toLocaleLowerCase('pt-BR')
export function normalizeName(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9\s]/g,' ').replace(corporateTerms,' ').replace(/\s+/g,' ').trim()}
export function normalizePhone(value){let phone=digits(value);if(phone.startsWith('00'))phone=phone.slice(2);if(!phone.startsWith('55')&&(phone.length===10||phone.length===11))phone=`55${phone}`;return phone}
export function normalizeWebsite(value){return String(value||'').trim().toLocaleLowerCase('pt-BR').replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/\/+$/,'').split(/[/?#]/)[0]}
export function normalizeInstagram(value){return String(value||'').trim().toLocaleLowerCase('pt-BR').replace(/^https?:\/\/(www\.)?instagram\.com\//,'').replace(/^@/,'').replace(/\/+$/,'')}
const bigrams=(value)=>{const text=` ${value} `,set=new Set();for(let index=0;index<text.length-1;index++)set.add(text.slice(index,index+2));return set}
export function nameSimilarity(left,right){const a=normalizeName(left),b=normalizeName(right);if(!a||!b)return 0;if(a===b)return 1;const x=bigrams(a),y=bigrams(b),intersection=[...x].filter((item)=>y.has(item)).length;return intersection*2/(x.size+y.size)}

export function compareClients(left,right){
  if(!left||!right||left.id===right.id)return{score:0,level:'none',signals:[]}
  if(left.organization_id&&right.organization_id&&left.organization_id!==right.organization_id)return{score:0,level:'blocked',signals:['Organizações diferentes']}
  const signals=[];let score=0
  const add=(condition,label,points)=>{if(condition){signals.push(label);score+=points}}
  const same=(a,b,normalizer)=>{const x=normalizer(a),y=normalizer(b);return Boolean(x&&y&&x===y)}
  add(same(left.document_number,right.document_number,digits),'Mesmo documento',100)
  add(same(left.phone,right.phone,normalizePhone),'Mesmo telefone principal',70)
  add(same(left.email,right.email,normalizeEmail),'Mesmo e-mail',70)
  add(same(left.website,right.website,normalizeWebsite),'Mesmo domínio/site',55)
  add(same(left.instagram,right.instagram,normalizeInstagram),'Mesmo Instagram',55)
  const names=[left.company_name,left.trade_name].filter(Boolean),otherNames=[right.company_name,right.trade_name].filter(Boolean)
  const similarity=Math.max(0,...names.flatMap((name)=>otherNames.map((other)=>nameSimilarity(name,other))))
  add(similarity===1,'Nome normalizado idêntico',65)
  add(similarity>=.78&&similarity<1,`Nomes semelhantes (${Math.round(similarity*100)}%)`,35)
  add(same(left.contact_name,right.contact_name,normalizeName),'Mesmo contato principal',20)
  add(same(left.billing_contact_phone,right.billing_contact_phone,normalizePhone),'Mesmo telefone financeiro',35)
  return{score,level:score>=70?'strong':score>=35?'partial':'low',signals,similarity}
}

export function buildDuplicateGroups(clients=[]){
  const edges=[]
  for(let left=0;left<clients.length;left++)for(let right=left+1;right<clients.length;right++){const comparison=compareClients(clients[left],clients[right]);if(['strong','partial'].includes(comparison.level))edges.push({left:clients[left].id,right:clients[right].id,comparison})}
  const parent=new Map(clients.map((client)=>[client.id,client.id]));const find=(id)=>{let root=id;while(parent.get(root)!==root)root=parent.get(root);while(parent.get(id)!==id){const next=parent.get(id);parent.set(id,root);id=next}return root};const union=(a,b)=>{const x=find(a),y=find(b);if(x!==y)parent.set(y,x)};edges.forEach((edge)=>union(edge.left,edge.right))
  const groups=new Map();clients.forEach((client)=>{const root=find(client.id),group=groups.get(root)||[];group.push(client);groups.set(root,group)})
  return[...groups.values()].filter((group)=>group.length>1).map((members)=>{const memberIds=new Set(members.map((item)=>item.id)),matches=edges.filter((edge)=>memberIds.has(edge.left)&&memberIds.has(edge.right)),score=Math.max(...matches.map((edge)=>edge.comparison.score));return{id:[...memberIds].sort().join(':'),members,matches,score,level:score>=70?'strong':'partial'}}).sort((a,b)=>b.score-a.score)
}
export const groupPossibleDuplicateClients=buildDuplicateGroups

export function clientCompleteness(client){const fields=['company_name','trade_name','contact_name','document_number','email','phone','website','instagram','segment','billing_contact_name','billing_contact_email','billing_contact_phone','primary_responsible_id'];return fields.reduce((sum,key)=>sum+Boolean(client?.[key]),0)}
