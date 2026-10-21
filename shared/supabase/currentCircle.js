import { supabase } from './client.js'

export async function currentCircleId() {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  const orgId = data?.session?.user?.app_metadata?.orgId
  return orgId ? String(orgId) : null
}
