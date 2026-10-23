import { supabase } from './client.js'
import { loginIdentifierToEmail } from './clientLogin.js'

const ADMIN_ROLES = new Set(['admin', 'owner', 'superadmin'])

function claimsFromUser(user, profile) {
  const appMeta = user?.app_metadata || {}
  const data = profile?.data || {}
  const appRole = String(appMeta.role || '').toLowerCase()
  const joining = appRole === 'employee_onboarding'
  // Only server-set claims decide company and role; profile data never elevates (it is editable).
  const profileRole = String(data.role || '').toLowerCase()
  const fallbackRole = profileRole && !ADMIN_ROLES.has(profileRole) ? profileRole : 'employee'
  return {
    orgId: appMeta.orgId || null,
    role: joining ? 'employee_onboarding' : (appRole || fallbackRole),
    tier: joining ? 'joining' : (appMeta.tier || data.tier || 'company'),
    business_uid: appMeta.business_uid || profile?.id || user?.id,
  }
}

function looksLikeAdminProfile(data = {}) {
  const role = String(data.role || '').toLowerCase()
  const roleName = String(data.roleName || '')
  const dept = String(data.departmentName || data.department || '')
  if (ADMIN_ROLES.has(role)) return true
  return /(admin|owner|superadmin|executive|founder)/i.test(`${roleName} ${dept}`)
}

function profileRoleScore(row, authUser) {
  const data = row?.data || {}
  const role = String(data.role || '').toLowerCase()
  let score = 0
  if (ADMIN_ROLES.has(role)) score += 200
  if (looksLikeAdminProfile(data)) score += 80
  if (role === 'employee' || role === 'client') score -= 80
  if (!role) score += 40
  if (row?.id && row.id !== authUser.id) score += 10
  if (data.email) score += 5
  if (data.displayName) score += 2
  return score
}

function pickBestProfile(rows, authUser) {
  if (!rows?.length) return null
  return [...rows].sort((a, b) => profileRoleScore(b, authUser) - profileRoleScore(a, authUser))[0]
}

async function loadProfile(authUser) {
  if (!supabase || !authUser) return null
  const rows = []
  const seen = new Set()
  const addRows = (list) => {
    for (const row of list || []) {
      if (!row?.id || seen.has(row.id)) continue
      seen.add(row.id)
      rows.push(row)
    }
  }

  const byAuth = await supabase.from('profiles').select('*').eq('auth_id', authUser.id)
  addRows(byAuth.data)
  if (authUser.email) {
    const byEmail = await supabase.from('profiles').select('*').eq('data->>email', authUser.email)
    addRows(byEmail.data)
  }
  const best = pickBestProfile(rows, authUser)
  if (best) return best
  const byId = await supabase.from('profiles').select('*').eq('id', authUser.id).limit(1)
  return byId.data?.[0] || null
}

async function sessionAfterSignIn(initial) {
  if (supabase) {
    await supabase.auth.refreshSession()
    const { data } = await supabase.auth.getSession()
    if (data.session) return data.session
  }
  return initial
}

function wrapUser(authUser, session, profile) {
  if (!authUser) return null
  const uid = profile?.id || authUser.id
  const data = profile?.data || {}
  return {
    uid,
    email: authUser.email,
    username: data.username || null,
    displayName: data.displayName || authUser.user_metadata?.displayName || authUser.user_metadata?.full_name || data.username || authUser.email?.split('@')[0],
    photoURL: data.photoURL || authUser.user_metadata?.avatar_url || null,
    phoneNumber: data.phoneNumber || authUser.phone || null,
    async getIdToken(forceRefresh) {
      if (forceRefresh) await supabase.auth.refreshSession()
      const { data: s } = await supabase.auth.getSession()
      return s.session?.access_token || session?.access_token || ''
    },
    async getIdTokenResult(forceRefresh) {
      if (forceRefresh) await supabase.auth.refreshSession()
      const { data: s } = await supabase.auth.getSession()
      const u = s.session?.user || authUser
      const p = await loadProfile(u)
      return { claims: claimsFromUser(u, p) }
    },
  }
}

export function getAuth() {
  return supabase
}

export class GoogleAuthProvider {}

export async function signInWithEmailAndPassword(_auth, identifier, password) {
  const email = loginIdentifierToEmail(identifier)
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  const session = await sessionAfterSignIn(data.session)
  const user = session?.user || data.user
  const profile = await loadProfile(user)
  return { user: wrapUser(user, session, profile) }
}

export async function createUserWithEmailAndPassword(_auth, email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw error
  const profile = await loadProfile(data.user)
  return { user: wrapUser(data.user, data.session, profile) }
}

export async function signInWithPopup() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { skipBrowserRedirect: false },
  })
  if (error) throw error
  return { user: wrapUser(data.user, data.session, await loadProfile(data.user)) }
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function sendPasswordResetEmail(_auth, email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email)
  if (error) throw error
}

export async function updateProfile(user, updates) {
  const data = {}
  if (updates.displayName !== undefined) {
    data.displayName = updates.displayName
    data.full_name = updates.displayName
  }
  if (updates.photoURL !== undefined) {
    data.photoURL = updates.photoURL
    data.avatar_url = updates.photoURL
  }
  if (Object.keys(data).length) {
    const { error } = await supabase.auth.updateUser({ data })
    if (error) throw error
  }
  if (updates.displayName) user.displayName = updates.displayName
  if (updates.photoURL !== undefined) user.photoURL = updates.photoURL
}

export async function updatePassword(_user, newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw error
}

export function onAuthStateChanged(_auth, callback) {
  if (!supabase) {
    callback(null)
    return () => {}
  }
  supabase.auth.getSession().then(async ({ data }) => {
    if (!data.session) {
      callback(null)
      return
    }
    callback(wrapUser(data.session.user, data.session, await loadProfile(data.session.user)))
  })
  const { data } = supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'TOKEN_REFRESHED') return
    if (!session) {
      callback(null)
      return
    }
    callback(wrapUser(session.user, session, await loadProfile(session.user)))
  })
  return () => data.subscription.unsubscribe()
}
