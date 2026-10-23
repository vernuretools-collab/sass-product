/** Internal auth addresses for username-only joining accounts. Never shown in the UI. */
export const JOINING_AUTH_EMAIL_DOMAINS = ['join.halo.local', 'joining.halo.local']

/** Domain used when a joining sign-in is created. */
export const JOINING_AUTH_EMAIL_DOMAIN = JOINING_AUTH_EMAIL_DOMAINS[0]

export const ONBOARDING_STATUS = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
}

export const JOINING_ROLE = 'employee_onboarding'

export const WORK_MODES = ['Office', 'Hybrid', 'Remote']

export const PROBATION_PERIODS = ['3 months', '6 months']

export const CUSTOM_KRA_TARGET = 80

export const FIXED_KRAS = [
  {
    keyResultArea: 'THEC Portal Compliance',
    kpi: 'Daily submission rate at least 95%',
    weight: 10,
  },
  {
    keyResultArea: 'Client Satisfaction & Professional Conduct',
    kpi: 'No escalations; positive manager feedback',
    weight: 10,
  },
]

export function isJoiningRole(role) {
  return String(role || '').trim().toLowerCase() === JOINING_ROLE
}

export function isJoiningEmail(email) {
  const value = String(email || '').trim().toLowerCase()
  return JOINING_AUTH_EMAIL_DOMAINS.some((domain) => value.endsWith(`@${domain}`))
}

export function joiningAuthEmails(username) {
  const login = normalizeJoiningUsername(username)
  return JOINING_AUTH_EMAIL_DOMAINS.map((domain) => `${login}@${domain}`)
}

export function isJoiningAccount({ role, email } = {}) {
  return isJoiningRole(role) || isJoiningEmail(email)
}

export function normalizeJoiningUsername(raw) {
  return String(raw || '').trim().toLowerCase().replace(/\s+/g, '')
}

export function isValidJoiningUsername(username) {
  return /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/.test(normalizeJoiningUsername(username))
}

export function joiningUsernameToAuthEmail(username) {
  return `${normalizeJoiningUsername(username)}@${JOINING_AUTH_EMAIL_DOMAIN}`
}

export function customKraWeight(kras = []) {
  return kras.reduce((sum, row) => sum + (Number(row?.weight) || 0), 0)
}

function localDate(value) {
  const text = String(value || '').trim()
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) return null
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())
}

function toIsoDate(date) {
  if (!date) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function addIsoDays(value, days) {
  const date = localDate(value)
  if (!date) return ''
  date.setDate(date.getDate() + days)
  return toIsoDate(date)
}

export function probationIsoDate(value, period) {
  const date = localDate(value)
  if (!date) return ''
  const text = String(period || '').toLowerCase()
  const months = text.includes('6') ? 6 : text.includes('1 month') ? 1 : text.includes('none') ? 0 : 3
  date.setMonth(date.getMonth() + months)
  return toIsoDate(date)
}

export const DEFAULT_LEARNING_PLAN = [
  { id: 'd30', label: 'Day 1–30', title: 'Understand & Set Up', points: '' },
  { id: 'd60', label: 'Day 31–60', title: 'Deliver & Contribute', points: '' },
  { id: 'd90', label: 'Day 61–90', title: 'Own & Optimise', points: '' },
]

export function defaultReviews(employment = {}) {
  const manager = String(employment.reportingManager || '').trim()
  return [
    { id: 'r30', review: '30-Day Review', date: addIsoDays(employment.dateOfJoining, 30), reviewer: manager, focus: '' },
    { id: 'r60', review: '60-Day Review', date: addIsoDays(employment.dateOfJoining, 60), reviewer: manager, focus: '' },
    { id: 'r90', review: '90-Day Review', date: addIsoDays(employment.dateOfJoining, 90), reviewer: 'Manager + Senior Mgmt', focus: '' },
    { id: 'probation', review: 'End of Probation', date: probationIsoDate(employment.dateOfJoining, employment.probationPeriod), reviewer: 'Manager + Co-Founder', focus: '' },
  ]
}

export function learningPoints(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean)
  return String(value || '').split(/\n+/).map((item) => item.trim()).filter(Boolean)
}

export function kraRowStarted(row) {
  return Boolean(String(row?.keyResultArea || '').trim() || String(row?.kpi || '').trim())
}

function learningPhaseStarted(phase) {
  const defaults = DEFAULT_LEARNING_PLAN.find((item) => item.id === phase?.id)
  const title = String(phase?.title || '').trim()
  const label = String(phase?.label || '').trim()
  if (learningPoints(phase?.points).length > 0) return true
  if (!defaults) return Boolean(title || label)
  return title !== defaults.title || label !== defaults.label
}

export function handbookValidationError({ kras = [], learningPlan = [], reviews = [] } = {}) {
  if (kras.some(kraRowStarted)) {
    for (const row of kras) {
      const area = String(row?.keyResultArea || '').trim()
      const kpi = String(row?.kpi || '').trim()
      const weight = Number(row?.weight)
      if (!area || !kpi) return 'Each KRA needs an area and a metric. Remove blank rows, or leave every row blank to add them later.'
      if (!Number.isFinite(weight) || weight <= 0) return 'Each KRA weight must be greater than 0.'
    }
    const weight = customKraWeight(kras)
    if (Math.abs(weight - CUSTOM_KRA_TARGET) > 0.001) {
      const gap = Math.abs(weight - CUSTOM_KRA_TARGET)
      const direction = weight > CUSTOM_KRA_TARGET ? 'Reduce' : 'Increase'
      return `Editable KRA weights total ${weight}%. ${direction} them by ${gap}% so they total ${CUSTOM_KRA_TARGET}%. Portal Compliance and Client Satisfaction already take 10% each.`
    }
  }

  const incompletePhase = (learningPlan || []).find((phase) => {
    if (!learningPhaseStarted(phase)) return false
    return !String(phase?.title || '').trim() || learningPoints(phase?.points).length === 0
  })
  if (incompletePhase) {
    return `Add a title and at least one task for ${incompletePhase.label || 'this phase'}. Put each task on its own line.`
  }

  if ((reviews || []).some((review) => String(review?.focus || '').trim())) {
    const incompleteReview = reviews.find((review) => !String(review?.review || '').trim() || !String(review?.focus || '').trim())
    if (incompleteReview) return `Add the focus for ${incompleteReview.review || 'each review'}.`
  }

  return ''
}

export function handbookPayload({ kras = [], learningPlan = [], reviews = [] } = {}) {
  const kraStarted = kras.some(kraRowStarted)
  const planStarted = (learningPlan || []).some(learningPhaseStarted)
  return {
    kras: kraStarted
      ? kras.map((row) => ({
        keyResultArea: String(row.keyResultArea || '').trim(),
        kpi: String(row.kpi || '').trim(),
        weight: Number(row.weight),
      }))
      : [],
    learningPlan: planStarted
      ? learningPlan.map((phase) => ({
        id: phase.id || '',
        label: String(phase.label || '').trim(),
        title: String(phase.title || '').trim(),
        points: learningPoints(phase.points),
      }))
      : [],
    reviews: (reviews || []).map((review) => ({
      id: review.id || '',
      review: String(review.review || '').trim(),
      date: String(review.date || '').trim(),
      reviewer: String(review.reviewer || '').trim(),
      focus: String(review.focus || '').trim(),
    })),
  }
}

export function joiningPageUrl() {
  if (typeof window === 'undefined') return 'http://localhost:3002/joining'
  const { protocol, hostname, port } = window.location
  const employeePort = port === '3001' ? '3002' : port
  const host = employeePort ? `${hostname}:${employeePort}` : hostname
  return `${protocol}//${host}/joining`
}

export function onboardingFromProfile(profile) {
  const data = profile?.data && typeof profile.data === 'object' ? profile.data : {}
  if (!profile?.id) return null
  if (!isJoiningRole(data.role) && !data.employment && !data.joiningStatus) return null
  return {
    id: profile.id,
    auth_id: profile.auth_id || profile.id,
    username: data.username || '',
    status: data.joiningStatus === 'submitted' ? 'submitted' : 'draft',
    employment: data.employment && typeof data.employment === 'object' ? data.employment : {},
    kras: data.kras && typeof data.kras === 'object' ? data.kras : { custom: [], fixed: FIXED_KRAS },
    answers: data.answers && typeof data.answers === 'object' ? data.answers : {},
    documents: Array.isArray(data.documents) ? data.documents : [],
    created_at: profile.created_at || data.createdAt || data.updatedAt,
    submitted_at: data.submittedAt || null,
    source: 'profile',
  }
}
