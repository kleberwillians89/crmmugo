import { dataProvider, getSupabaseClient } from '../../lib/supabase/client'
export const isSupabaseProvider=()=>dataProvider==='supabase'
export const db=()=>getSupabaseClient()
export const organizationSlug=()=>import.meta.env.VITE_DEFAULT_ORGANIZATION_ID||'mugo'
export async function organizationId(){const {data,error}=await db().from('organizations').select('id').eq('slug',organizationSlug()).single();if(error)throw error;return data.id}
export const legacyUnavailable=(resource)=>{throw new Error(`${resource} está disponível após selecionar o provider Supabase.`)}
export const unwrap=({data,error})=>{if(error)throw error;return data}
