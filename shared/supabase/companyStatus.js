import { supabase } from './client.js'

const MESSAGES = {
  suspended: 'This company is suspended. Contact the platform administrator.',
  inactive: 'This company is not set up yet. Contact the platform administrator.',
  past_due: 'The subscription payment for this company failed. The company admin needs to update billing before you can sign in.',
  unpaid: 'The subscription for this company is unpaid. The company admin needs to update billing before you can sign in.',
  canceled: 'The subscription for this company has ended. Contact the platform administrator.',
}

// Signs the user out unless their company is open. The database refuses every company row for an
// inactive company anyway; this only gives the user a clear message instead of an empty portal.
// 'none' means the session carries no company (operator or not yet provisioned) and is left alone.
export async function rejectSuspendedCompany(logout) {
  if (!supabase) return
  const { data, error } = await supabase.rpc('current_company_status')
  if (error) {
    if (error.code === 'PGRST202') return
    throw error
  }
  const status = String(data || '')
  if (status === 'active' || status === 'none' || status === '') return

  if (logout) await logout()
  else await supabase.auth.signOut()
  const err = new Error(MESSAGES[status] || 'This company is not active. Contact the platform administrator.')
  err.code = status === 'suspended' ? 'company-suspended' : 'company-inactive'
  throw err
}
