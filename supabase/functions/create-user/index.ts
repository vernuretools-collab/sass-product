import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const CLIENT_AUTH_EMAIL_DOMAIN = 'client.halo.local'
const JOINING_AUTH_EMAIL_DOMAIN = 'join.halo.local'
const FIXED_KRAS = [
  { keyResultArea: 'THEC Portal Compliance', kpi: 'Portal compliance', weight: 10, locked: true },
  { keyResultArea: 'Client Satisfaction', kpi: 'Client satisfaction', weight: 10, locked: true },
]

function normalizeUsername(raw: string) {
  return String(raw || '').trim().toLowerCase().replace(/\s+/g, '')
}

function isValidUsername(username: string) {
  return /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/.test(username)
}

function usernameToAuthEmail(username: string) {
  return `${normalizeUsername(username)}@${CLIENT_AUTH_EMAIL_DOMAIN}`
}

function joiningUsernameToAuthEmail(username: string) {
  return `${normalizeUsername(username)}@${JOINING_AUTH_EMAIL_DOMAIN}`
}

function textField(value: unknown) {
  return String(value || '').trim()
}

function sanitizeEmployment(raw: Record<string, unknown> | undefined) {
  const source = raw || {}
  return {
    employeeId: textField(source.employeeId),
    fullName: textField(source.fullName),
    designation: textField(source.designation),
    department: textField(source.department),
    reportingManager: textField(source.reportingManager),
    dateOfJoining: textField(source.dateOfJoining),
    workMode: textField(source.workMode),
    monthlyCtc: textField(source.monthlyCtc),
    probationPeriod: textField(source.probationPeriod),
    workLocation: textField(source.workLocation),
    assets: textField(source.assets),
    issueDate: textField(source.issueDate),
  }
}

function requiredEmploymentError(employment: ReturnType<typeof sanitizeEmployment>) {
  const required = [
    ['employeeId', 'Employee ID'],
    ['fullName', 'Full name'],
    ['designation', 'Designation'],
    ['department', 'Department'],
    ['reportingManager', 'Reporting manager'],
    ['dateOfJoining', 'Date of joining'],
    ['workMode', 'Work mode'],
    ['monthlyCtc', 'Monthly CTC'],
  ]
  for (const [key, label] of required) {
    if (!employment[key as keyof typeof employment]) return `${label} is required`
  }
  return ''
}

function sanitizeLearningPlan(raw: unknown) {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => {
    const row = item as { id?: string; label?: string; title?: string; points?: unknown }
    const points = Array.isArray(row.points)
      ? row.points.map((point) => String(point || '').trim()).filter(Boolean)
      : String(row.points || '').split(/\n+/).map((point) => point.trim()).filter(Boolean)
    return {
      id: String(row.id || ''),
      label: String(row.label || '').trim(),
      title: String(row.title || '').trim(),
      points,
    }
  }).filter((row) => row.label || row.title)
}

function sanitizeReviews(raw: unknown) {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => {
    const row = item as { id?: string; review?: string; date?: string; reviewer?: string; focus?: string }
    return {
      id: String(row.id || ''),
      review: String(row.review || '').trim(),
      date: String(row.date || '').trim(),
      reviewer: String(row.reviewer || '').trim(),
      focus: String(row.focus || '').trim(),
    }
  }).filter((row) => row.review)
}

function kraError(rows: unknown) {
  if (!Array.isArray(rows) || rows.length === 0) return ''
  let total = 0
  for (const raw of rows) {
    const row = raw as { keyResultArea?: string; kpi?: string; weight?: number }
    const area = String(row.keyResultArea || '').trim()
    const kpi = String(row.kpi || '').trim()
    const weight = Number(row.weight)
    if (!area || !kpi) return 'Each KRA needs an area and a metric'
    if (!Number.isFinite(weight) || weight <= 0) return 'Each KRA weight must be greater than 0'
    total += weight
  }
  if (Math.abs(total - 80) > 0.001) return 'KRA weights must total 80%'
  return ''
}

function isJoiningLoginEmail(email: string) {
  const value = String(email || '').trim().toLowerCase()
  return value.endsWith('@join.halo.local') || value.endsWith('@joining.halo.local')
}

async function rememberJoiningPassword(admin, uid: string, password: string) {
  if (!uid || password.length < 6) return
  await admin.from('employee_onboarding').update({ login_password: password }).eq('auth_id', uid)
  const { data: profile } = await admin.from('profiles').select('id, data').eq('id', uid).maybeSingle()
  if (!profile) return
  const role = String(profile.data?.role || '').toLowerCase()
  const email = String(profile.data?.email || '')
  if (role !== 'employee_onboarding' && !isJoiningLoginEmail(email)) return
  await admin.from('profiles').update({
    data: { ...(profile.data || {}), loginPassword: password },
    updated_at: new Date().toISOString(),
  }).eq('id', profile.id)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const admin = createClient(supabaseUrl, serviceKey)
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
  })

  const { data: authData, error: authErr } = await userClient.auth.getUser()
  if (authErr || !authData.user) {
    return json({ error: 'unauthenticated' }, 401)
  }

  const role = String(authData.user.app_metadata?.role || '').toLowerCase()
  if (!['admin', 'owner', 'superadmin'].includes(role)) {
    return json({ error: 'permission-denied' }, 403)
  }

  const orgId = String(authData.user.app_metadata?.orgId || '')
  if (!orgId) {
    return json({ error: 'This account is not in a company circle' }, 403)
  }

  const body = await req.json()
  const password = String(body.password || '')
  const kind = body.type || 'employee'

  if (body.action === 'set-password') {
    const uid = String(body.uid || '').trim()
    if (!uid || password.length < 6) {
      return json({ error: 'uid and a password of at least 6 characters are required' }, 400)
    }
    const { error: updateErr } = await admin.auth.admin.updateUserById(uid, { password })
    if (updateErr) return json({ error: updateErr.message }, 400)
    await rememberJoiningPassword(admin, uid, password)
    return json({ ok: true })
  }

  if (body.action === 'delete-user') {
    const uid = String(body.uid || '').trim()
    if (!uid || uid.length > 80) return json({ error: 'A valid user id is required' }, 400)
    if (uid === authData.user.id) return json({ error: 'You cannot delete your own account' }, 400)

    const { data: byId, error: byIdErr } = await admin.from('profiles').select('id,auth_id,org_id,data').eq('id', uid).maybeSingle()
    if (byIdErr) return json({ error: byIdErr.message }, 400)
    let target = byId
    if (!target) {
      const { data: byAuth, error: byAuthErr } = await admin.from('profiles').select('id,auth_id,org_id,data').eq('auth_id', uid).maybeSingle()
      if (byAuthErr) return json({ error: byAuthErr.message }, 400)
      target = byAuth
    }
    const targetRole = String(target?.data?.role || '').toLowerCase()
    if (target && targetRole && targetRole !== 'client') {
      return json({ error: 'Only client portal users can be deleted here' }, 400)
    }
    const targetOrg = String(target?.org_id || target?.data?.orgId || '')
    if (target && targetOrg !== orgId) {
      return json({ error: 'permission-denied' }, 403)
    }

    const authId = String(target?.auth_id || uid)
    const profileId = String(target?.id || uid)
    const { error: authDeleteErr } = await admin.auth.admin.deleteUser(authId)
    if (authDeleteErr && !/not found/i.test(authDeleteErr.message || '')) {
      return json({ error: authDeleteErr.message }, 400)
    }

    const [onboardById, onboardByUser, profileDelete] = await Promise.all([
      admin.from('client_onboarding').delete().eq('id', profileId).eq('org_id', orgId),
      admin.from('client_onboarding').delete().eq('user_id', profileId).eq('org_id', orgId),
      admin.from('profiles').delete().eq('id', profileId).eq('org_id', orgId),
    ])
    const cleanupErr = onboardById.error || onboardByUser.error || profileDelete.error
    if (cleanupErr) return json({ error: cleanupErr.message }, 400)
    return json({ ok: true })
  }

  if (body.action === 'delete-onboarding') {
    const id = String(body.id || '').trim()
    const username = normalizeUsername(body.username || '')
    const authIdHint = String(body.authId || body.uid || '').trim()
    if ((!id || id.length > 80) && !username) return json({ error: 'A valid onboarding id is required' }, 400)

    let row = null
    if (id) {
      const byId = await admin.from('employee_onboarding').select('id, auth_id, org_id, username').eq('id', id).maybeSingle()
      if (byId.error) return json({ error: byId.error.message }, 400)
      row = byId.data
    }
    if (!row && username) {
      const byName = await admin.from('employee_onboarding').select('id, auth_id, org_id, username').eq('username', username).maybeSingle()
      if (byName.error) return json({ error: byName.error.message }, 400)
      row = byName.data
    }
    if (row && String(row.org_id || '') !== orgId) return json({ error: 'permission-denied' }, 403)

    const login = normalizeUsername(row?.username || username)
    const authIds = new Set<string>()
    const profileIds = new Set<string>()
    if (row?.auth_id) authIds.add(String(row.auth_id))
    if (authIdHint && authIdHint !== authData.user.id) authIds.add(authIdHint)

    const considerProfile = (profile) => {
      if (!profile?.id) return
      const targetRole = String(profile.data?.role || '').toLowerCase()
      const email = String(profile.data?.email || '')
      const joining = targetRole === 'employee_onboarding' || isJoiningLoginEmail(email) || (!targetRole && authIds.has(String(profile.id)))
      if (!joining || targetRole === 'admin' || targetRole === 'employee' || targetRole === 'client') return
      profileIds.add(String(profile.id))
      if (profile.auth_id) authIds.add(String(profile.auth_id))
    }

    if (login) {
      const named = await admin.from('profiles').select('id, auth_id, data').eq('data->>username', login)
      if (named.error) return json({ error: named.error.message }, 400)
      for (const profile of named.data || []) considerProfile(profile)
    }
    if (id) {
      const byProfileId = await admin.from('profiles').select('id, auth_id, data').eq('id', id).maybeSingle()
      if (byProfileId.error) return json({ error: byProfileId.error.message }, 400)
      considerProfile(byProfileId.data)
    }
    for (const authId of [...authIds]) {
      const byAuth = await admin.from('profiles').select('id, auth_id, data').eq('id', authId).maybeSingle()
      if (byAuth.error) return json({ error: byAuth.error.message }, 400)
      considerProfile(byAuth.data)
    }

    if (!row && profileIds.size === 0) return json({ error: 'Onboarding record not found' }, 404)

    for (const profileId of profileIds) {
      const employee = await admin.from('employees').select('id, data').eq('id', profileId).maybeSingle()
      const employeeEmail = String(employee.data?.data?.email || '').toLowerCase()
      if (isJoiningLoginEmail(employeeEmail)) {
        const { error: employeeErr } = await admin.from('employees').delete().eq('id', profileId)
        if (employeeErr) return json({ error: employeeErr.message }, 400)
      }
      const { error: profileErr } = await admin.from('profiles').delete().eq('id', profileId)
      if (profileErr) return json({ error: profileErr.message }, 400)
    }
    if (row) {
      const { error: deleteErr } = await admin.from('employee_onboarding').delete().eq('id', row.id)
      if (deleteErr) return json({ error: deleteErr.message }, 400)
    }
    for (const authId of authIds) {
      if (!authId || authId === authData.user.id) continue
      const { error: authDeleteErr } = await admin.auth.admin.deleteUser(authId)
      if (authDeleteErr && !/not found/i.test(authDeleteErr.message || '')) {
        return json({ ok: true, authWarning: authDeleteErr.message })
      }
    }
    return json({ ok: true })
  }

  if (kind === 'employee_onboarding') {
    const username = normalizeUsername(body.username)
    if (!isValidUsername(username)) {
      return json({ error: 'username must be 3–32 characters: letters, numbers, dots, underscores, or hyphens' }, 400)
    }
    if (password.length < 6) {
      return json({ error: 'password must be at least 6 characters' }, 400)
    }
    const employment = sanitizeEmployment(body.employment)
    const employmentError = requiredEmploymentError(employment)
    if (employmentError) return json({ error: employmentError }, 400)
    const customKras = Array.isArray(body.kras) ? body.kras : []
    const weightError = kraError(customKras)
    if (weightError) return json({ error: weightError }, 400)
    const learningPlan = sanitizeLearningPlan(body.learningPlan)
    const reviews = sanitizeReviews(body.reviews)

    const email = joiningUsernameToAuthEmail(username)
    const displayName = String(employment.fullName || username).trim()
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { role: 'employee_onboarding', orgId, tier: 'joining' },
      user_metadata: { displayName, username },
    })
    if (createErr) return json({ error: createErr.message }, 400)

    const uid = created.user.id
    const now = new Date().toISOString()
    const { data: row, error: insertErr } = await admin.from('employee_onboarding').insert({
      org_id: orgId,
      auth_id: uid,
      username,
      status: 'awaiting_answers',
      login_password: password,
      employment,
      kras: {
        custom: customKras.map((row) => ({
          keyResultArea: String(row.keyResultArea || '').trim(),
          kpi: String(row.kpi || '').trim(),
          weight: Number(row.weight),
        })),
        fixed: FIXED_KRAS,
        learningPlan,
        reviews,
      },
      answers: {},
      documents: [],
      updated_at: now,
    }).select('id, username, status').single()

    if (insertErr) {
      await admin.auth.admin.deleteUser(uid)
      return json({ error: insertErr.message }, 400)
    }
    return json({ id: row.id, username: row.username, status: row.status, joiningPath: '/joining' })
  }

  let email = String(body.email || '').trim().toLowerCase()
  let username = normalizeUsername(body.username)
  if (kind === 'client') {
    if (!username && email.endsWith(`@${CLIENT_AUTH_EMAIL_DOMAIN}`)) {
      username = email.split('@')[0]
    }
    if (!isValidUsername(username)) {
      return json({ error: 'username must be 3–32 characters: letters, numbers, dots, underscores, or hyphens' }, 400)
    }
    email = usernameToAuthEmail(username)
  }
  if (!email || !password) {
    return json({ error: kind === 'client' ? 'username and password required' : 'email and password required' }, 400)
  }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: {
      role: kind === 'client' ? 'client' : kind === 'admin' ? 'admin' : 'employee',
      orgId,
      tier: kind === 'client' ? 'client' : 'company',
    },
    user_metadata: { displayName: body.displayName || username || email.split('@')[0], username: username || null },
  })
  if (createErr) return json({ error: createErr.message }, 400)

  const uid = created.user.id
  const now = new Date().toISOString()

  if (kind === 'client') {
    const clientData = {
      uid,
      username,
      email,
      displayName: String(body.displayName || username).trim().replace(/\s+/g, ' '),
      companyName: body.companyName || '',
      phoneNumber: body.phone || null,
      role: 'client',
      tier: 'client',
      status: 'active',
      onboardingStatus: body.onboardingStatus || 'pending_signature',
      createdAt: now,
      updatedAt: now,
    }
    await Promise.all([
      admin.from('profiles').upsert({
        id: uid,
        auth_id: uid,
        org_id: orgId,
        data: { ...clientData, orgId },
        updated_at: now,
      }),
      admin.from('client_onboarding').upsert({
        id: uid,
        user_id: uid,
        org_id: orgId,
        data: body.onboardingData || { uid, email, orgId, ...clientData },
        updated_at: now,
      }),
    ])
    return json(clientData)
  }

  if (kind === 'admin') {
    const adminData = {
      uid,
      email,
      displayName: body.displayName,
      roleName: body.roleName || 'Executive Admin',
      departmentName: 'Executive Management',
      role: 'admin',
      tier: 'company',
      status: 'active',
      orgId,
      createdAt: now,
      updatedAt: now,
    }
    await admin.from('profiles').upsert({
      id: uid,
      auth_id: uid,
      org_id: orgId,
      data: adminData,
      updated_at: now,
    })
    return json(adminData)
  }

  const emp = {
    uid,
    email,
    displayName: body.displayName,
    roleName: body.roleName || 'Software Specialist',
    departmentName: body.departmentName || 'Engineering & Product',
    phoneNumber: body.phone || body.phoneNumber || ' ',
    skills: ['Productivity'],
    status: 'active',
    joinedAt: now.split('T')[0],
    utilizationRate: 85,
    role: 'employee',
    tier: 'company',
    orgId,
    createdAt: now,
    updatedAt: now,
  }
  await admin.from('profiles').upsert({
    id: uid,
    auth_id: uid,
    org_id: orgId,
    data: emp,
    updated_at: now,
  })
  await admin.from('employees').upsert({
    id: uid,
    user_id: uid,
    org_id: orgId,
    data: emp,
    updated_at: now,
  })
  return json(emp)
})

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
