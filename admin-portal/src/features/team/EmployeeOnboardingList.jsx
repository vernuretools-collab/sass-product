import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PageHeader } from '../../components/layout/PageHeader'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Modal } from '../../components/ui/Modal'
import { TeamSubNav } from './components/TeamSubNav'
import { deleteEmployeeOnboarding, listEmployeeOnboarding } from './services/employeeOnboardingService'
import { EmployeeOnboardingSetup } from './EmployeeOnboardingSetup'
import { ONBOARDING_STATUS, joiningPageUrl } from '../../../../shared/supabase/employeeOnboarding.js'
import { Trash2, UserPlus } from 'lucide-react'

function statusLabel(status) {
  if (status === ONBOARDING_STATUS.SUBMITTED) return 'Submitted'
  return 'Waiting for answers'
}

export const EmployeeOnboardingList = () => {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()
  const [setupOpen, setSetupOpen] = useState(() => searchParams.get('setup') === '1')
  const joiningUrl = joiningPageUrl()

  const loadRows = useCallback(() => {
    return listEmployeeOnboarding()
      .then((data) => {
        setRows(data)
        setError('')
      })
      .catch((err) => {
        setError(err.message || 'Could not load onboarding records.')
      })
  }, [])

  useEffect(() => {
    let cancelled = false
    listEmployeeOnboarding()
      .then((data) => {
        if (!cancelled) setRows(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Could not load onboarding records.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (searchParams.get('setup') === '1') setSetupOpen(true)
  }, [searchParams])

  const openSetup = () => setSetupOpen(true)

  const closeSetup = () => {
    setSetupOpen(false)
    if (searchParams.get('setup')) {
      const next = new URLSearchParams(searchParams)
      next.delete('setup')
      setSearchParams(next, { replace: true })
    }
  }

  const counts = useMemo(() => {
    const submitted = rows.filter((row) => row.status === ONBOARDING_STATUS.SUBMITTED).length
    return { submitted, waiting: rows.length - submitted }
  }, [rows])

  const closeConfirm = () => {
    if (deleting) return
    setPending(null)
    setDeleteError('')
  }

  const confirmDelete = async () => {
    if (!pending || deleting) return
    setDeleting(true)
    setDeleteError('')
    try {
      await deleteEmployeeOnboarding(pending.id)
      setRows((current) => current.filter((row) => row.id !== pending.id))
      setPending(null)
    } catch (err) {
      setDeleteError(err.message || 'Could not delete this onboarding record.')
    } finally {
      setDeleting(false)
    }
  }

  const pendingName = pending?.employment?.fullName || 'this hire'
  const pendingUsername = pending?.username || ''

  return (
    <div className="space-y-6">
      <PageHeader
        title="Employee Onboarding"
        description="Username and password are created in Setup new employee. The hire signs in at the joining page with that same login."
        actions={
          <Button icon={UserPlus} onClick={openSetup}>Setup new employee</Button>
        }
      />
      <TeamSubNav />

      <Card className="space-y-2">
        <p className="text-sm text-fg">Joining page for new hires: <span className="font-medium">{joiningUrl}</span></p>
        <p className="text-xs text-muted">Waiting for answers = hire has not submitted yet. Submitted = click the employee name to see the filled form and download the 3 PDF packs.</p>
      </Card>

      {!loading && rows.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Badge variant="warning">{counts.waiting} waiting</Badge>
          <Badge variant="success">{counts.submitted} submitted</Badge>
        </div>
      )}

      {error && (
        <p className="text-sm text-rose-600">{error}</p>
      )}

      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-chrome text-muted text-xs uppercase">
            <tr>
              <th className="px-4 py-3 font-semibold">Employee</th>
              <th className="px-4 py-3 font-semibold">Department</th>
              <th className="px-4 py-3 font-semibold">Joining username</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-muted">Loading onboarding records…</td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10">
                  <div className="flex flex-col items-center gap-3 text-center">
                    <p className="text-sm text-muted">No onboarding records yet.</p>
                    <Button icon={UserPlus} onClick={openSetup}>Setup new employee</Button>
                  </div>
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const employment = row.employment || {}
              const submitted = row.status === ONBOARDING_STATUS.SUBMITTED
              return (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-4 py-3">
                    <Link to={`/team/onboarding/${row.id}`} className="font-medium text-fg hover:text-accent cursor-pointer">
                      {employment.fullName || 'Unnamed hire'}
                    </Link>
                    <p className="text-xs text-muted">{employment.employeeId || '—'}</p>
                  </td>
                  <td className="px-4 py-3 text-muted">{employment.department || '—'}</td>
                  <td className="px-4 py-3">{row.username}</td>
                  <td className="px-4 py-3">
                    <Badge variant={submitted ? 'success' : 'warning'}>
                      {statusLabel(row.status)}
                    </Badge>
                    {submitted && (
                      <p className="text-[11px] text-muted mt-1">Click the name to open answers and PDFs</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <Link to={`/team/onboarding/${row.id}`}>
                        <Button type="button" variant="secondary" size="sm">Open</Button>
                      </Link>
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        icon={Trash2}
                        disabled={deleting && pending?.id === row.id}
                        onClick={() => {
                          setDeleteError('')
                          setPending(row)
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>

      <Modal
        open={setupOpen}
        onClose={closeSetup}
        title="Setup new employee"
        size="xl"
      >
        <EmployeeOnboardingSetup embedded onClose={closeSetup} onCreated={() => { loadRows() }} />
      </Modal>

      <Modal
        open={Boolean(pending)}
        onClose={closeConfirm}
        title="Delete onboarding record"
        size="sm"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={closeConfirm} disabled={deleting}>
              Cancel
            </Button>
            <Button type="button" variant="danger" onClick={confirmDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-fg">
          Delete {pendingName}{pendingUsername ? ` (${pendingUsername})` : ''}? This removes the onboarding record and the joining login.
        </p>
        {deleteError && <p className="text-sm text-rose-600 mt-3">{deleteError}</p>}
      </Modal>
    </div>
  )
}
