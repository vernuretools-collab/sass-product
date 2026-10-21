import { supabase } from './client.js'

export async function rejectSuspendedCompany(logout) {
  if (!supabase) return
  const { data, error } = await supabase.rpc('current_company_status')
  if (error) {
    if (error.code === 'PGRST202') return
    throw error
  }
  if (data === 'suspended') {
    if (logout) await logout()
    else await supabase.auth.signOut()
    const err = new Error('This company is suspended. Contact the platform administrator.')
    err.code = 'company-suspended'
    throw err
  }
}
