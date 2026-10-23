import { createClient } from '@supabase/supabase-js'
import { supabase } from '../../../shared/services/firebaseService'
import { FIXED_KRAS, JOINING_ROLE, joiningUsernameToAuthEmail, learningPoints, onboardingFromProfile } from '../../../../../shared/supabase/employeeOnboarding.js'

async function invokeCreateUser(body) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.functions.invoke('create-user', { body })
  const payloadError = data?.error || data?.message
  if (!error && !payloadError) return data

  let detail = payloadError || error?.message || 'Failed to create the joining account.'
  try {
    if (error?.context && typeof error.context.json === 'function') {
      const payload = await error.context.json()
      detail = payload?.error || payload?.message || detail
    }
  } catch {
    /* gateway response had no JSON body */
  }
  if (detail === 'Failed to send a request to the Edge Function' || detail === 'Requested function was not found') {
    detail = 'The create-user Edge Function is not deployed on this Supabase project.'
  }
  throw new Error(detail)
}

function joiningAuthId(data) {
  const uid = String(data?.uid || '').trim()
  if (uid) return uid
  const id = String(data?.id || '').trim()
  return /^[0-9a-f-]{36}$/i.test(id) ? id : ''
}

function savedKraRows(kras) {
  const rows = Array.isArray(kras) ? kras : Array.isArray(kras?.custom) ? kras.custom : []
  return rows.filter((row) => row && typeof row === 'object')
}

function handbookKras({ kras, learningPlan, reviews }) {
  return {
    custom: savedKraRows(kras),
    fixed: FIXED_KRAS,
    learningPlan: (learningPlan || []).map((phase) => ({
      id: phase.id || '',
      label: String(phase.label || '').trim(),
      title: String(phase.title || '').trim(),
      points: learningPoints(phase.points),
    })),
    reviews: (reviews || []).map((review) => ({
      id: review.id || '',
      review: String(review.review || '').trim(),
      date: String(review.date || '').trim(),
      reviewer: String(review.reviewer || '').trim(),
      focus: String(review.focus || '').trim(),
    })),
  }
}

function alreadyRegistered(error) {
  return /already been registered/i.test(String(error?.message || error || ''))
}

function sameEmail(row, email) {
  return String(row?.data?.email || '').trim().toLowerCase() === email
}

async function findJoiningAuthId(email) {
  const { data: matched } = await supabase
    .from('profiles')
    .select('id, auth_id, data')
    .eq('data->>email', email)
    .limit(1)
  const direct = matched?.[0]
  if (direct && sameEmail(direct, email)) return direct.auth_id || direct.id

  const { data: profiles } = await supabase.from('profiles').select('id, auth_id, data').limit(500)
  const profile = (profiles || []).find((row) => sameEmail(row, email))
  if (profile) return profile.auth_id || profile.id

  const { data: employees } = await supabase.from('employees').select('id, auth_id, user_id, data').limit(500)
  const employee = (employees || []).find((row) => sameEmail(row, email))
  return employee?.auth_id || employee?.user_id || employee?.id || ''
}

async function linkJoiningAuth(onboardingId, authId) {
  if (!onboardingId || !authId) return
  const { error } = await supabase.from('employee_onboarding').update({ auth_id: authId }).eq('id', onboardingId)
  if (error) throw error
}

async function setJoiningPassword(authId, password, email) {
  await invokeCreateUser({ action: 'set-password', uid: authId || '', email, password })
}

async function ensureJoiningPassword(email, password, authId) {
  try {
    await setJoiningPassword(authId, password, email)
  } catch (err) {
    if (!alreadyRegistered(err) && !/no sign-in exists/i.test(String(err.message || ''))) throw err
  }
  await assertJoiningPasswordWorks(email, password)
}

async function createJoiningAuthUser({ username, password, email, displayName, employment }) {
  try {
    const data = await invokeCreateUser({
      type: 'employee',
      email,
      password,
      username,
      displayName: displayName || username,
      departmentName: employment?.department || 'Human Resources',
      roleName: employment?.designation || 'New hire',
    })
    return { ...data, uid: joiningAuthId(data), email }
  } catch (err) {
    if (!alreadyRegistered(err)) throw err
    return { uid: await findJoiningAuthId(email), email }
  }
}

async function saveHandbookKras({ id, authId, kras }) {
  if (!kras) return
  if (id) {
    const { data, error } = await supabase.from('employee_onboarding').update({ kras }).eq('id', id).select('id')
    if (!error && data?.length) return
  }
  if (authId) await supabase.from('employee_onboarding').update({ kras }).eq('auth_id', authId)
}

async function markJoiningProfile(authId, { username, email, displayName, employment, kras, password }) {
  if (!authId) return
  const { data: profile } = await supabase.from('profiles').select('id, data').eq('id', authId).maybeSingle()
  const current = profile?.data && typeof profile.data === 'object' ? profile.data : {}
  const { error } = await supabase.from('profiles').upsert({
    id: authId,
    auth_id: authId,
    data: {
      ...current,
      uid: authId,
      username,
      email,
      displayName: displayName || current.displayName || username,
      role: JOINING_ROLE,
      status: 'active',
      joiningStatus: current.joiningStatus === 'submitted' ? 'submitted' : 'draft',
      employment: employment || current.employment || {},
      kras: kras?.learningPlan || kras?.reviews
        ? kras
        : {
          custom: savedKraRows(kras || current.kras),
          fixed: FIXED_KRAS,
          learningPlan: current.kras?.learningPlan || [],
          reviews: current.kras?.reviews || [],
        },
      answers: current.answers || {},
    },
    updated_at: new Date().toISOString(),
  })
  if (error) throw error
}

async function saveOnboardingViaFunction({ username, password, email, displayName, employment, kras, learningPlan, reviews, onboardingId }) {
  try {
    return await invokeCreateUser({
      action: 'ensure-joining-login',
      type: 'employee_onboarding',
      onboardingId: onboardingId || '',
      username,
      password,
      email,
      displayName,
      employment,
      kras: savedKraRows(kras),
      learningPlan,
      reviews,
    })
  } catch {
    return null
  }
}

async function assertJoiningPasswordWorks(email, password) {
  const checker = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, storageKey: 'joining-password-check' },
  })
  const { error } = await checker.auth.signInWithPassword({ email, password })
  if (!error) {
    await checker.auth.signOut()
    return
  }
  const detail = String(error.message || error.error_code || '')
  if (/invalid login|invalid_credentials/i.test(detail)) {
    throw new Error('The joining sign-in was not created. Click Save & create joining login again. If it still fails, the create-user function did not save this username.')
  }
  throw new Error(detail || 'Joining sign-in failed after creating the account.')
}

export async function resetJoiningLogin({ id, username, password, displayName, employment }) {
  const record = id ? await getEmployeeOnboarding(id) : null
  const savedEmployment = { ...(employment || {}), ...(record?.employment || {}) }
  const login = username || record?.username
  const email = joiningUsernameToAuthEmail(login)
  const created = await createJoiningAuthUser({
    username: login,
    password,
    email,
    displayName: displayName || savedEmployment.fullName || login,
    employment: savedEmployment,
  })
  const authId = created.uid || await findJoiningAuthId(email)
  await ensureJoiningPassword(email, password, authId)
  await markJoiningProfile(authId, {
    username: login,
    email,
    displayName: displayName || savedEmployment.fullName,
    employment: savedEmployment,
    kras: record?.kras,
    password,
  })
  try {
    await linkJoiningAuth(id, authId)
  } catch {
    /* employee_onboarding may block client writes; profile is enough. */
  }
  await saveOnboardingViaFunction({
    username: login,
    password,
    email,
    displayName: displayName || savedEmployment.fullName,
    employment: savedEmployment,
    kras: record?.kras,
    onboardingId: id,
  })
  return { uid: authId, email, username: login }
}

export async function createEmployeeOnboarding({ username, password, employment, kras, learningPlan, reviews }) {
  const email = joiningUsernameToAuthEmail(username)
  const handbook = handbookKras({ kras, learningPlan, reviews })
  const created = await createJoiningAuthUser({
    username,
    password,
    email,
    displayName: employment?.fullName || username,
    employment,
  })
  const authId = created.uid || await findJoiningAuthId(email)
  if (!authId) throw new Error('The joining sign-in could not be created.')
  await ensureJoiningPassword(email, password, authId)
  await markJoiningProfile(authId, {
    username,
    email,
    displayName: employment?.fullName || username,
    employment,
    kras: handbook,
    password,
  })
  const viaFunction = await saveOnboardingViaFunction({
    username,
    password,
    email,
    displayName: employment?.fullName || username,
    employment,
    kras,
    learningPlan: handbook.learningPlan,
    reviews: handbook.reviews,
    onboardingId: authId,
  })
  const recordId = viaFunction?.id || authId
  await saveHandbookKras({ id: recordId, authId, kras: handbook })
  return { ...created, ...viaFunction, id: recordId, uid: authId, username, email, kras: handbook }
}

export async function updateEmployeeHandbook({ id, authId, kras, learningPlan, reviews }) {
  const handbook = handbookKras({ kras, learningPlan, reviews })
  const now = new Date().toISOString()
  let saved = false
  if (id) {
    const { data, error } = await supabase.from('employee_onboarding').update({ kras: handbook, updated_at: now }).eq('id', id).select('id')
    if (error) throw error
    saved = Boolean(data?.length)
  }
  if (!saved && authId) {
    const { data, error } = await supabase.from('employee_onboarding').update({ kras: handbook, updated_at: now }).eq('auth_id', authId).select('id')
    if (error) throw error
    saved = Boolean(data?.length)
  }

  const profileIds = [...new Set([authId, id].filter(Boolean))]
  let profileSaved = false
  for (const profileId of profileIds) {
    const { data: profile, error: readErr } = await supabase.from('profiles').select('id, data').eq('id', profileId).maybeSingle()
    if (readErr) throw readErr
    if (!profile) continue
    const current = profile.data && typeof profile.data === 'object' ? profile.data : {}
    const { error } = await supabase.from('profiles').update({
      data: { ...current, kras: handbook },
      updated_at: now,
    }).eq('id', profile.id)
    if (error) throw error
    profileSaved = true
  }

  if (!saved && !profileSaved) throw new Error('Could not save the handbook on this record.')
  return handbook
}

export async function deleteEmployeeOnboarding(id) {
  const record = await getEmployeeOnboarding(id)
  if (!record) throw new Error('Onboarding record not found')
  await invokeCreateUser({
    action: 'delete-onboarding',
    id: record.id || id,
    username: record.username || '',
    authId: record.auth_id || '',
  })
}

function mergeKras(tableKras, profileKras) {
  const table = tableKras && typeof tableKras === 'object' && !Array.isArray(tableKras) ? tableKras : {}
  const profile = profileKras && typeof profileKras === 'object' && !Array.isArray(profileKras) ? profileKras : {}
  return {
    ...table,
    ...profile,
    custom: profile.custom?.length ? profile.custom : (table.custom || []),
    fixed: profile.fixed?.length ? profile.fixed : (table.fixed || FIXED_KRAS),
    learningPlan: profile.learningPlan?.length ? profile.learningPlan : (table.learningPlan || []),
    reviews: profile.reviews?.length ? profile.reviews : (table.reviews || []),
  }
}

function mergeOnboarding(tableRow, profileRow) {
  const fromProfile = onboardingFromProfile(profileRow)
  if (!tableRow) return fromProfile
  if (!fromProfile) return tableRow
  const submitted = fromProfile.status === 'submitted' || tableRow.status === 'submitted'
  return {
    ...tableRow,
    status: submitted ? 'submitted' : tableRow.status,
    answers: fromProfile.answers && Object.keys(fromProfile.answers).length ? fromProfile.answers : tableRow.answers,
    employment: { ...(tableRow.employment || {}), ...(fromProfile.employment || {}) },
    kras: mergeKras(tableRow.kras, fromProfile.kras),
    submitted_at: fromProfile.submitted_at || tableRow.submitted_at,
    auth_id: tableRow.auth_id || fromProfile.auth_id,
  }
}

export async function listEmployeeOnboarding() {
  const { data, error } = await supabase
    .from('employee_onboarding')
    .select('id, username, status, employment, created_at, submitted_at, auth_id')
    .order('created_at', { ascending: false })
  const tableRows = error ? [] : data || []
  const { data: profiles } = await supabase.from('profiles').select('id, auth_id, data, created_at').eq('data->>role', JOINING_ROLE)
  const profileList = profiles || []
  const merged = tableRows.map((row) => {
    const profile = profileList.find((item) => item.id === row.id || item.id === row.auth_id || item.auth_id === row.auth_id || String(item.data?.username || '').toLowerCase() === String(row.username || '').toLowerCase())
    return mergeOnboarding(row, profile)
  })
  const seen = new Set(merged.map((row) => String(row.username || '').toLowerCase()))
  const extras = profileList.map(onboardingFromProfile).filter((row) => row?.username && !seen.has(row.username.toLowerCase()))
  return [...merged, ...extras]
}

export async function getEmployeeOnboarding(id) {
  const { data } = await supabase.from('employee_onboarding').select('*').eq('id', id).maybeSingle()
  const { data: profileById } = await supabase.from('profiles').select('id, auth_id, data, created_at').eq('id', id).maybeSingle()
  let profile = profileById
  if (!profile && data?.auth_id) {
    const { data: profileByAuth } = await supabase.from('profiles').select('id, auth_id, data, created_at').eq('id', data.auth_id).maybeSingle()
    profile = profileByAuth
  }
  if (!profile && data?.username) {
    const { data: profileByName } = await supabase.from('profiles').select('id, auth_id, data, created_at').eq('data->>username', data.username).maybeSingle()
    profile = profileByName
  }
  return mergeOnboarding(data, profile)
}
