export const CRM_DATA_CHANGED='mugo:crm-data-changed'
export function invalidateCrmData(detail){if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent(CRM_DATA_CHANGED,{detail}))}
