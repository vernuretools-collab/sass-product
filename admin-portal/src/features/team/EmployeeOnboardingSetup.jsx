import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../../components/layout/PageHeader'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { TeamSubNav } from './components/TeamSubNav'
import { HandbookFields, emptyKra } from './components/HandbookFields'
import { getDepartments } from './services/teamService'
import { createEmployeeOnboarding } from './services/employeeOnboardingService'
import {
  DEFAULT_LEARNING_PLAN,
  PROBATION_PERIODS,
  WORK_MODES,
  defaultReviews,
  handbookPayload,
  handbookValidationError,
  isValidJoiningUsername,
  joiningPageUrl,
  normalizeJoiningUsername,
} from '../../../../shared/supabase/employeeOnboarding.js'

const FALLBACK_DEPARTMENTS = ['Sales', 'Engineering & Product', 'Operations', 'Human Resources']

export const EmployeeOnboardingSetup = ({ embedded = false, onClose, onCreated }) => {
  const [departments, setDepartments] = useState(FALLBACK_DEPARTMENTS)
  const [employment, setEmployment] = useState({
    employeeId: '',
    fullName: '',
    designation: '',
    department: FALLBACK_DEPARTMENTS[0],
    reportingManager: '',
    dateOfJoining: '',
    workMode: WORK_MODES[0],
    monthlyCtc: '',
    probationPeriod: '3 months',
    workLocation: '',
    assets: '',
    issueDate: '',
  })
  const [kras, setKras] = useState([emptyKra(40), emptyKra(20), emptyKra(20)])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [learningPlan, setLearningPlan] = useState(() => DEFAULT_LEARNING_PLAN.map((row) => ({ ...row })))
  const [reviews, setReviews] = useState(() => defaultReviews())
  const reviewTouched = useRef({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [created, setCreated] = useState(null)

  useEffect(() => {
    getDepartments()
      .then((rows) => {
        const names = rows.map((row) => row.name).filter(Boolean)
        if (names.length === 0) return
        setDepartments(names)
        setEmployment((current) => ({ ...current, department: current.department || names[0] }))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const next = defaultReviews(employment)
    setReviews((current) => current.map((row) => {
      const fresh = next.find((item) => item.id === row.id) || row
      return {
        ...row,
        date: reviewTouched.current[`${row.id}:date`] ? row.date : fresh.date,
        reviewer: reviewTouched.current[`${row.id}:reviewer`] ? row.reviewer : fresh.reviewer,
      }
    }))
  }, [employment.dateOfJoining, employment.probationPeriod, employment.reportingManager])

  const setField = (key, value) => setEmployment((current) => ({ ...current, [key]: value }))

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    const login = normalizeJoiningUsername(username)
    if (!isValidJoiningUsername(login)) {
      setError('Username must be 3–32 characters: letters, numbers, dots, underscores, or hyphens.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    const handbookError = handbookValidationError({ kras, learningPlan, reviews })
    if (handbookError) {
      setError(handbookError)
      return
    }
    const handbook = handbookPayload({ kras, learningPlan, reviews })
    setSaving(true)
    try {
      const result = await createEmployeeOnboarding({
        username: login,
        password,
        employment,
        ...handbook,
      })
      const createdRow = { ...result, username: login, password, url: joiningPageUrl() }
      setCreated(createdRow)
      onCreated?.(createdRow)
    } catch (err) {
      setError(err.message || 'Could not create the joining account.')
    } finally {
      setSaving(false)
    }
  }

  if (created) {
    const ready = (
      <Card className="space-y-3 max-w-xl">
          <p className="text-sm text-fg"><span className="text-muted">Joining page</span><br />{created.url}</p>
          <p className="text-sm text-fg"><span className="text-muted">Username</span><br />{created.username}</p>
          <p className="text-sm text-fg"><span className="text-muted">Password</span><br />{created.password}</p>
          <p className="text-xs text-muted">Copy this login now. The password is not stored and will not be shown again; reset it from the onboarding record if it is lost.</p>
          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigator.clipboard?.writeText(`${created.url}\nUsername: ${created.username}\nPassword: ${created.password}`)}
            >
              Copy details
            </Button>
            {embedded ? (
              <Button type="button" variant="primary" onClick={onClose}>Done</Button>
            ) : (
              <Link to="/team/onboarding">
                <Button type="button" variant="primary">Back to list</Button>
              </Link>
            )}
          </div>
        </Card>
    )
    if (embedded) return ready
    return (
      <div className="space-y-6">
        <PageHeader
          title="Joining login ready"
          description="Share this page and username with the hire. This login cannot open the employee portal."
        />
        <TeamSubNav />
        {ready}
      </div>
    )
  }

  const form = (
      <form onSubmit={handleSubmit} className="space-y-4">
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-accent mb-4">Employment details</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label="Employee ID *" placeholder="e.g. THEC-2026-SAL-001" value={employment.employeeId} onChange={(e) => setField('employeeId', e.target.value)} required />
            <Input label="Full name *" placeholder="Employee's full name" value={employment.fullName} onChange={(e) => setField('fullName', e.target.value)} required />
            <Input label="Designation *" placeholder="e.g. Inside Sales Executive" value={employment.designation} onChange={(e) => setField('designation', e.target.value)} required />
            <label className="w-full space-y-1.5 text-left">
              <span className="block text-xs font-medium text-fg">Department *</span>
              <select
                className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
                value={employment.department}
                onChange={(e) => setField('department', e.target.value)}
                required
              >
                {departments.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            <Input label="Reporting manager *" value={employment.reportingManager} onChange={(e) => setField('reportingManager', e.target.value)} required />
            <Input label="Date of joining *" type="date" value={employment.dateOfJoining} onChange={(e) => setField('dateOfJoining', e.target.value)} required />
            <label className="w-full space-y-1.5 text-left">
              <span className="block text-xs font-medium text-fg">Work mode *</span>
              <select
                className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
                value={employment.workMode}
                onChange={(e) => setField('workMode', e.target.value)}
                required
              >
                {WORK_MODES.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
              </select>
            </label>
            <Input label="Monthly CTC (₹) *" placeholder="e.g. 20,000" value={employment.monthlyCtc} onChange={(e) => setField('monthlyCtc', e.target.value)} required />
            <label className="w-full space-y-1.5 text-left">
              <span className="block text-xs font-medium text-fg">Probation period</span>
              <select
                className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
                value={employment.probationPeriod}
                onChange={(e) => setField('probationPeriod', e.target.value)}
              >
                {PROBATION_PERIODS.map((period) => <option key={period} value={period}>{period}</option>)}
              </select>
            </label>
            <Input label="Work location" placeholder="Padi, Chennai" value={employment.workLocation} onChange={(e) => setField('workLocation', e.target.value)} />
            <div>
              <Input label="Assets to be issued" placeholder="Laptop, mouse — or leave blank / None" value={employment.assets} onChange={(e) => setField('assets', e.target.value)} />
              <p className="text-xs text-muted mt-1">Leave blank or type None / Nil if nothing is issued. Asset pages appear in the packs only when you list real items.</p>
            </div>
            <Input label="Issue date" type="date" value={employment.issueDate} onChange={(e) => setField('issueDate', e.target.value)} />
          </div>
        </Card>

        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-accent mb-1">Joining login</p>
          <p className="text-sm text-muted mb-4">This is the only joining login. Give these details to the hire for the joining page. They cannot sign in to the employee portal.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label="Username *" placeholder="e.g. priya.sales" value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="off" />
            <Input label="Password *" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" />
          </div>
        </Card>

        <HandbookFields
          kras={kras}
          setKras={setKras}
          learningPlan={learningPlan}
          setLearningPlan={setLearningPlan}
          reviews={reviews}
          setReviews={setReviews}
          onReviewTouch={(key) => { reviewTouched.current[key] = true }}
        />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save & create joining login'}</Button>
      </form>
  )

  if (embedded) return form

  return (
    <div className="space-y-6">
      <PageHeader
        title="Setup New Employee"
        description="Enter the employment details. These will be pre-filled (read-only) for the employee in their form."
      />
      <TeamSubNav />
      <Link to="/team/onboarding" className="text-sm text-accent font-medium">← Back to onboarding list</Link>
      {form}
    </div>
  )
}
