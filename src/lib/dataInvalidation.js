export const CRM_DATA_CHANGED='mugo:crm-data-changed'
export const CRM_RESOURCES=Object.freeze({contracts:'contracts',proposals:'proposals',clients:'clients',installments:'installments',finance:'finance',dashboard:'dashboard',intelligence:'intelligence',services:'services',team:'team',timeline:'timeline'})
export function invalidateCrmData(detail){if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent(CRM_DATA_CHANGED,{detail}))}
export function affectsResource(detail,resource){const resources=detail?.resources;return!Array.isArray(resources)||resources.length===0||resources.includes(resource)}
