import {db,isSupabaseProvider,legacyUnavailable,unwrap} from './provider'
export async function normalizeLegacyCommercialData(){if(!isSupabaseProvider())return legacyUnavailable('Integridade comercial');return unwrap(await db().rpc('normalize_legacy_commercial_data'))}
