import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../../components/layout/PageHeader'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { useTeamStore } from './stores/teamStore'
import { useSettingsStore } from '../settings/stores/settingsStore'
import {
  getEmployees,
  getDepartments,
  createEmployee,
  deleteEmployeeFromDb,
  createDepartment,
  updateEmployeeInDb,
} from './services/teamService'
import { currentMonthStr } from './services/monthlyReportEngine'
import { isAttendancePresent } from './services/attendanceStatsUtils'
import { db } from '../../shared/services/firebaseService'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { createEmployeeAccount, createAdminAccount } from '../../shared/services/authService'
import { EmployeeAvatar } from '../../../../shared/ui/EmployeeAvatar.jsx'
import { TeamSubNav } from './components/TeamSubNav'
import {
  Users,
  UserPlus,
  Search,
  Mail,
  Building,
  X,
  Trash2,
  TrendingUp,
  Edit,
  ShieldCheck,
  Tag,
  Plus,
  FileText,
  CalendarDays,
  CheckCircle2,
  AlertCircle,
  UserX,
} from 'lucide-react'

function todayDateStr() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export const EmployeeList = () => {
  const { employees, departments, setEmployees, setDepartments, addEmployee, deleteEmployee, updateEmployee } = useTeamStore()
  const { customRoles } = useSettingsStore()

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedDept, setSelectedDept] = useState('all')
  const [selectedRole, setSelectedRole] = useState('all')
  const [accountType, setAccountType] = useState('employee') // 'employee' or 'admin'
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingEmployee, setEditingEmployee] = useState(null)
  const [deleteConfirmEmp, setDeleteConfirmEmp] = useState(null)

  // New member form
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [roleName, setRoleName] = useState('')
  const [departmentName, setDepartmentName] = useState('Engineering & Product')
  const [customDept, setCustomDept] = useState('')
  const [isCustomDept, setIsCustomDept] = useState(false)
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [listError, setListError] = useState('')
  const [success, setSuccess] = useState('')

  // Edit-specific fields
  const [utilizationRate, setUtilizationRate] = useState(85)
  const [skills, setSkills] = useState([])
  const [skillInput, setSkillInput] = useState('')
  const [joiningDate, setJoiningDate] = useState('')
  const [bio, setBio] = useState('')
  const [todayPresence, setTodayPresence] = useState({})
  const thisMonth = currentMonthStr()

  const createdRoles = customRoles.filter((r) => !r.isSystem)

  useEffect(() => {
    const fetchRealEmployees = async () => {
      setListError('')
      try {
        const [emps, depts] = await Promise.all([getEmployees(), getDepartments()])
        if (emps) setEmployees(emps)
        if (depts) setDepartments(depts)
      } catch (err) {
        console.error('Error loading employee directory:', err)
        setListError(err?.message || 'Could not load team members. Sign in again and retry.')
        setEmployees([])
      }
    }
    fetchRealEmployees()
  }, [setEmployees, setDepartments])

  useEffect(() => {
    const today = todayDateStr()
    const logsQuery = query(collection(db, 'attendanceLogs'), where('date', '==', today))
    const unsub = onSnapshot(
      logsQuery,
      (snap) => {
        const map = {}
        snap.docs.forEach((d) => {
          const log = { id: d.id, ...d.data() }
          const present = isAttendancePresent(log)
          if (log.uid) map[String(log.uid)] = present
          const idParts = String(d.id).split('_')
          if (idParts.length > 1) map[idParts.slice(1).join('_')] = present
        })
        setTodayPresence(map)
      },
      (err) => {
        console.warn('Could not load today attendance:', err)
      }
    )
    return () => unsub()
  }, [])

  const uniqueDepartments = Array.from(
    new Set(employees.map((emp) => emp.departmentName || emp.department).filter(Boolean))
  )

  const uniqueRoles = Array.from(
    new Set([
      ...createdRoles.map((r) => r.name),
      ...employees.map((emp) => emp.roleName || emp.role).filter(Boolean),
    ])
  )

  const filtered = employees.filter((emp) => {
    const matchesSearch =
      !searchQuery ||
      (emp.displayName && emp.displayName.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (emp.roleName && emp.roleName.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (emp.role && emp.role.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (emp.email && emp.email.toLowerCase().includes(searchQuery.toLowerCase()))

    const empDept = emp.departmentName || emp.department || ''
    const matchesDept = selectedDept === 'all' || empDept.trim().toLowerCase() === selectedDept.trim().toLowerCase()

    const empRole = emp.roleName || emp.role || ''
    const matchesRole = selectedRole === 'all' || empRole.trim().toLowerCase() === selectedRole.trim().toLowerCase()

    return matchesSearch && matchesDept && matchesRole
  })

  // Team Metrics
  const totalHeadcount = employees.length

  const handleInviteMember = async (e) => {
    e.preventDefault()
    if (!name.trim() || !email.trim() || !password.trim()) {
      setError('Please fill in all required fields.')
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    let finalDept = departmentName
    if (isCustomDept) {
      if (!customDept.trim()) {
        setError('Please fill in all required fields.')
        return
      }
      finalDept = customDept.trim()
    }

    setLoading(true)
    setError('')
    setSuccess('')

    try {
      let created
      if (accountType === 'admin') {
        created = await createAdminAccount(
          email,
          password,
          name,
          roleName || 'Executive Admin'
        )
        // Do NOT add admin to the employee list — admins are stored in /users only, not /employees
        setSuccess(`Admin account created successfully for ${email}! They can now log in to the Admin Portal.`)
      } else {
        if (isCustomDept) {
          const createdDept = await createDepartment(finalDept)
          setDepartments([...departments, createdDept])
        }

        created = await createEmployeeAccount(
          email,
          password,
          name,
          roleName,
          finalDept,
          phone
        )
        addEmployee(created)
        setSuccess(`Employee account created successfully for ${email}!`)
      }

      setName('')
      setEmail('')
      setRoleName('')
      setPhone('')
      setPassword('')
      setCustomDept('')
      setIsCustomDept(false)

      setTimeout(() => {
        setShowAddModal(false)
        setSuccess('')
      }, 1500)
    } catch (err) {
      console.error(err)
      setError(err.message || 'Failed to create account.')
    } finally {
      setLoading(false)
    }
  }

  const handleEditClick = (emp) => {
    setEditingEmployee(emp)
    setName(emp.displayName || '')
    setEmail(emp.email || '')
    setRoleName(emp.roleName || '')
    setPhone(emp.phoneNumber || emp.phone || '')
    setUtilizationRate(emp.utilizationRate ?? 85)
    setSkills(Array.isArray(emp.skills) ? emp.skills.filter(Boolean) : [])
    setSkillInput('')
    setJoiningDate(emp.joiningDate || emp.startDate || '')
    setBio(emp.bio || emp.about || '')

    const isCustom = !departments.some((d) => d.name === emp.departmentName)
    if (isCustom && emp.departmentName) {
      setIsCustomDept(true)
      setCustomDept(emp.departmentName)
      setDepartmentName('')
    } else {
      setIsCustomDept(false)
      setCustomDept('')
      setDepartmentName(emp.departmentName || departments[0]?.name || '')
    }
    setError('')
    setSuccess('')
    setShowEditModal(true)
  }

  const handleAddSkill = () => {
    const trimmed = skillInput.trim()
    if (trimmed && !skills.includes(trimmed)) {
      setSkills([...skills, trimmed])
    }
    setSkillInput('')
  }

  const handleRemoveSkill = (skill) => {
    setSkills(skills.filter((s) => s !== skill))
  }

  const handleUpdateMember = async (e) => {
    e.preventDefault()
    if (!name.trim() || !email.trim()) {
      setError('Please fill in all required fields.')
      return
    }

    let finalDept = departmentName
    if (isCustomDept) {
      if (!customDept.trim()) {
        setError('Please fill in all required fields.')
        return
      }
      finalDept = customDept.trim()
    }

    setLoading(true)
    setError('')
    setSuccess('')

    try {
      if (isCustomDept) {
        const createdDept = await createDepartment(finalDept)
        setDepartments([...departments, createdDept])
      }

      const updatedFields = {
        displayName: name,
        email,
        roleName,
        departmentName: finalDept,
        phoneNumber: phone,
        phone,
        utilizationRate: Number(utilizationRate),
        skills,
        joiningDate,
        startDate: joiningDate,
        bio,
        about: bio,
      }

      const uid = editingEmployee.uid || editingEmployee.employeeId
      await updateEmployeeInDb(uid, updatedFields)
      updateEmployee(uid, updatedFields)

      setSuccess('Employee details updated successfully!')

      setTimeout(() => {
        setShowEditModal(false)
        setSuccess('')
        setEditingEmployee(null)
      }, 1500)
    } catch (err) {
      console.error(err)
      setError(err.message || 'Failed to update employee details.')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteEmployee = async (uid) => {
    deleteEmployee(uid)
    await deleteEmployeeFromDb(uid)
  }

  return (
    <div className="space-y-6">
      {/* Header & Sub Nav */}
      <div className="space-y-4">
        <PageHeader
          title="Team & Personnel Management"
          description="Manage employees, organizational chart, attendance, utilization rates, and leave workflows"
          actions={
            <Button icon={UserPlus} variant="primary" onClick={() => setShowAddModal(true)}>
              Invite Member
            </Button>
          }
        />

        <TeamSubNav />

        <div className="flex items-center justify-end gap-3">
          <div className="flex items-center gap-3">
            <select
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
              className="bg-canvas border border-border text-xs text-fg rounded-xl px-3 py-1.5 focus:outline-none"
            >
              <option value="all">All Departments</option>
              {uniqueDepartments.map((deptName) => (
                <option key={deptName} value={deptName}>
                  {deptName}
                </option>
              ))}
            </select>

            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              className="bg-canvas border border-border text-xs text-fg rounded-xl px-3 py-1.5 focus:outline-none cursor-pointer"
            >
              <option value="all">All Roles</option>
              {uniqueRoles.map((roleName) => (
                <option key={roleName} value={roleName}>
                  {roleName}
                </option>
              ))}
            </select>

            <div className="relative w-64">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="text"
                placeholder="Search member, role..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-canvas border border-border text-xs text-fg placeholder:text-muted rounded-xl pl-8 pr-3 py-1.5 focus:outline-none transition-colors"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Summary Metrics */}
      <Card className="p-4 flex items-center justify-between border-border max-w-sm">
        <div>
          <span className="text-[11px] font-medium text-muted uppercase tracking-wider">
            Total Team Members
          </span>
          <p className="text-xl font-bold text-fg mt-1">{totalHeadcount} Members</p>
        </div>
        <div className="w-9 h-9 rounded-xl bg-accent-soft text-accent flex items-center justify-center">
          <Users className="w-5 h-5" />
        </div>
      </Card>

      {listError && (
        <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-600 dark:text-rose-400 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{listError}</span>
        </div>
      )}

      {/* Employee Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filtered.map((emp) => {
          const empUid = emp.uid || emp.employeeId || emp.id
          const identityIds = [empUid, ...(Array.isArray(emp.identityIds) ? emp.identityIds : [])]
            .filter(Boolean)
            .map(String)
          const presentToday = identityIds.some((id) => todayPresence[id] === true)

          return (
            <Card key={empUid} hover className="space-y-3.5 border-border relative group">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <EmployeeAvatar
                    src={emp.photoURL || emp.avatar}
                    name={emp.displayName || emp.email}
                    className="w-10 h-10 rounded-xl bg-gradient-to-tr from-accent to-accent-hover text-white font-bold text-sm shadow-md shadow-accent/20"
                  />
                  <div className="min-w-0">
                    <h4 className="font-bold text-fg text-sm group-hover:text-accent dark:group-hover:text-accent transition-colors truncate">
                      {emp.displayName}
                    </h4>
                    <p className="text-xs text-muted truncate">{emp.roleName}</p>
                  </div>
                </div>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border shrink-0 ${
                    presentToday
                      ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200/60 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400'
                      : 'bg-rose-50 dark:bg-rose-500/10 border-rose-200/60 dark:border-rose-500/20 text-rose-700 dark:text-rose-400'
                  }`}
                  title={presentToday ? 'Present today' : 'Absent today'}
                >
                  {presentToday ? <CheckCircle2 className="w-3 h-3" /> : <UserX className="w-3 h-3" />}
                  {presentToday ? 'Present' : 'Absent'}
                </span>
              </div>

              <div className="space-y-1 text-xs text-muted pt-1">
                <div className="flex items-center gap-2">
                  <Building className="w-3.5 h-3.5 text-muted" />
                  <span className="text-fg font-medium">{emp.departmentName}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Mail className="w-3.5 h-3.5 text-muted" />
                  <span className="truncate text-muted">{emp.email}</span>
                </div>
              </div>

              {/* Skills Badges */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {emp.skills
                  ?.filter((skill) => skill && skill.toLowerCase() !== 'productivity')
                  .map((skill, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 rounded-md bg-canvas border border-border text-[10px] text-fg font-medium"
                    >
                      {skill}
                    </span>
                  ))}
              </div>

              {/* Clean Footer */}
              <div className="pt-3 border-t border-border/60 flex items-center justify-between gap-1">
                <div className="flex items-center gap-0.5">
                  <Link
                    to="/team/attendance"
                    className="p-1.5 text-muted hover:text-emerald-600 dark:hover:text-emerald-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    title="Attendance"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                  </Link>
                  <Link
                    to={`/team/timeline?uid=${encodeURIComponent(empUid)}`}
                    className="p-1.5 text-muted hover:text-accent dark:hover:text-accent rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    title="Work Timeline"
                  >
                    <CalendarDays className="w-4 h-4" />
                  </Link>
                  <Link
                    to={`/team/reports?uid=${encodeURIComponent(empUid)}&month=${thisMonth}`}
                    className="p-1.5 text-muted hover:text-accent dark:hover:text-accent rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    title="Monthly Report"
                  >
                    <FileText className="w-4 h-4" />
                  </Link>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleEditClick(emp)}
                    className="p-1.5 text-muted hover:text-accent dark:hover:text-accent rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    title="Edit Member"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setDeleteConfirmEmp(emp)}
                    className="p-1.5 text-muted hover:text-rose-600 dark:hover:text-rose-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    title="Remove Member"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      {/* Invite Member Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-lg p-6 space-y-4 border-border shadow-2xl relative bg-surface">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="font-bold text-fg text-sm">Invite Team Member</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {error && (
              <div className="p-3 text-xs bg-rose-500/10 text-rose-500 rounded-xl border border-rose-500/20">
                {error}
              </div>
            )}

            {success && (
              <div className="p-3 text-xs bg-emerald-500/10 text-emerald-500 rounded-xl border border-emerald-500/20">
                {success}
              </div>
            )}

            <form onSubmit={handleInviteMember} className="space-y-4">
              {/* Account Type Selector */}
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-fg">Account Access Level *</label>
                <div className="grid grid-cols-2 p-1 bg-canvas rounded-xl border border-border text-xs">
                  <button
                    type="button"
                    onClick={() => setAccountType('employee')}
                    className={`py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-1.5 ${
                      accountType === 'employee'
                        ? 'bg-accent text-white shadow-sm font-semibold'
                        : 'text-muted hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Users className="w-3.5 h-3.5" /> Employee Staff
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccountType('admin')}
                    className={`py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-1.5 ${
                      accountType === 'admin'
                        ? 'bg-accent text-white shadow-sm font-semibold'
                        : 'text-muted hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <ShieldCheck className="w-3.5 h-3.5" /> Admin / Executive
                  </button>
                </div>
              </div>

              <Input
                label="Full Name *"
                placeholder="e.g. Alex Rivera"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />

              <Input
                label="Work Email *"
                type="email"
                placeholder="alex@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />

              <Input
                label="Account Password *"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />

              {accountType !== 'admin' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    {createdRoles.length > 0 ? (
                      <div className="space-y-1.5 text-left">
                        <label className="block text-xs font-medium text-fg">Role Title *</label>
                        <select
                          value={roleName}
                          onChange={(e) => setRoleName(e.target.value)}
                          className="w-full bg-canvas border border-border text-fg text-sm rounded-xl py-2.5 px-3.5 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all cursor-pointer"
                          required
                        >
                          <option value="">Select Role</option>
                          {createdRoles.map((role) => (
                            <option key={role.roleId} value={role.name} className="bg-surface text-fg">
                              {role.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <Input
                        label="Role Title"
                        placeholder="e.g. Senior Frontend Engineer"
                        value={roleName}
                        onChange={(e) => setRoleName(e.target.value)}
                      />
                    )}
                    {isCustomDept ? (
                      <div className="space-y-1.5 text-left">
                        <div className="flex justify-between items-center">
                          <label className="block text-xs font-medium text-fg">Custom Department *</label>
                          <button
                            type="button"
                            onClick={() => {
                              setIsCustomDept(false)
                              setDepartmentName(departments[0]?.name || '')
                            }}
                            className="text-[10px] text-accent hover:text-accent dark:hover:text-accent font-bold"
                          >
                            Choose Existing
                          </button>
                        </div>
                        <Input
                          placeholder="e.g. Quality Assurance"
                          value={customDept}
                          onChange={(e) => setCustomDept(e.target.value)}
                          required
                        />
                      </div>
                    ) : (
                      <div className="space-y-1.5 text-left">
                        <label className="block text-xs font-medium text-fg">Department</label>
                        <select
                          value={departmentName}
                          onChange={(e) => {
                            if (e.target.value === 'ADD_CUSTOM') {
                              setIsCustomDept(true)
                              setDepartmentName('')
                            } else {
                              setDepartmentName(e.target.value)
                            }
                          }}
                          className="w-full bg-canvas border border-border text-fg text-sm rounded-xl py-2.5 px-3.5 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all cursor-pointer"
                        >
                          {departments.map((d) => (
                            <option key={d.deptId} value={d.name} className="bg-surface text-fg">
                              {d.name}
                            </option>
                          ))}
                          <option value="ADD_CUSTOM" className="bg-surface text-accent font-semibold">
                            + Add Custom Department
                          </option>
                        </select>
                      </div>
                    )}
                  </div>

                  <Input
                    label="Phone Number"
                    placeholder=" "
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </>
              )}

              <div className="flex gap-3 pt-2">
                <Button type="button" variant="secondary" onClick={() => setShowAddModal(false)} className="w-1/3" disabled={loading}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" className="w-2/3 animate-pulse-subtle" icon={UserPlus} disabled={loading}>
                  {loading ? 'Creating Account...' : accountType === 'admin' ? 'Create Admin Account' : 'Create Employee Account'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Edit Member Modal */}
      {showEditModal && editingEmployee && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-2xl p-6 border-border shadow-2xl relative bg-surface max-h-[92vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-border mb-5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-accent-soft text-accent flex items-center justify-center">
                  <Edit className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-fg text-sm">Edit Employee Details</h3>
                  <p className="text-[11px] text-muted mt-0.5">{editingEmployee.displayName}</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowEditModal(false)
                  setEditingEmployee(null)
                }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {error && (
              <div className="mb-4 p-3 text-xs bg-rose-500/10 text-rose-500 rounded-xl border border-rose-500/20">
                {error}
              </div>
            )}
            {success && (
              <div className="mb-4 p-3 text-xs bg-emerald-500/10 text-emerald-500 rounded-xl border border-emerald-500/20">
                {success}
              </div>
            )}

            <form onSubmit={handleUpdateMember} className="space-y-5">

              {/* ── Section: Basic Info ── */}
              <div>
                <p className="text-[11px] font-semibold text-accent uppercase tracking-widest mb-3 flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" /> Basic Information
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    label="Full Name *"
                    placeholder="e.g. Alex Rivera"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                  <Input
                    label="Work Email *"
                    type="email"
                    placeholder="alex@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                  <Input
                    label="Phone Number"
                    placeholder="+1 (555) 000-0000"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                  <Input
                    label="Joining Date"
                    type="date"
                    value={joiningDate}
                    onChange={(e) => setJoiningDate(e.target.value)}
                  />
                </div>
              </div>

              {/* ── Section: Role & Department ── */}
              <div>
                <p className="text-[11px] font-semibold text-accent uppercase tracking-widest mb-3 flex items-center gap-1.5">
                  <Building className="w-3.5 h-3.5" /> Role & Department
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {createdRoles.length > 0 ? (
                    <div className="space-y-1.5 text-left">
                      <label className="block text-xs font-medium text-fg">Role Title</label>
                      <select
                        value={roleName}
                        onChange={(e) => setRoleName(e.target.value)}
                        className="w-full bg-canvas border border-border text-fg text-sm rounded-xl py-2.5 px-3.5 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all cursor-pointer"
                      >
                        <option value="">Select Role</option>
                        {createdRoles.map((role) => (
                          <option key={role.roleId} value={role.name} className="bg-surface text-fg">
                            {role.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <Input
                      label="Role Title"
                      placeholder="e.g. Senior Frontend Engineer"
                      value={roleName}
                      onChange={(e) => setRoleName(e.target.value)}
                    />
                  )}

                  {isCustomDept ? (
                    <div className="space-y-1.5 text-left">
                      <div className="flex justify-between items-center">
                        <label className="block text-xs font-medium text-fg">Custom Department *</label>
                        <button
                          type="button"
                          onClick={() => { setIsCustomDept(false); setDepartmentName(departments[0]?.name || '') }}
                          className="text-[10px] text-accent hover:text-accent font-bold"
                        >
                          Choose Existing
                        </button>
                      </div>
                      <Input
                        placeholder="e.g. Quality Assurance"
                        value={customDept}
                        onChange={(e) => setCustomDept(e.target.value)}
                        required
                      />
                    </div>
                  ) : (
                    <div className="space-y-1.5 text-left">
                      <label className="block text-xs font-medium text-fg">Department</label>
                      <select
                        value={departmentName}
                        onChange={(e) => {
                          if (e.target.value === 'ADD_CUSTOM') { setIsCustomDept(true); setDepartmentName('') }
                          else setDepartmentName(e.target.value)
                        }}
                        className="w-full bg-canvas border border-border text-fg text-sm rounded-xl py-2.5 px-3.5 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all cursor-pointer"
                      >
                        {departments.map((d) => (
                          <option key={d.deptId} value={d.name} className="bg-surface text-fg">{d.name}</option>
                        ))}
                        <option value="ADD_CUSTOM" className="bg-surface text-accent font-semibold">+ Add Custom Department</option>
                      </select>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Section: Performance ── */}
              <div>
                <p className="text-[11px] font-semibold text-accent uppercase tracking-widest mb-3 flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5" /> Performance
                </p>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-fg">Utilization Rate</label>
                    <span className="text-xs font-bold text-accent">{utilizationRate}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={utilizationRate}
                    onChange={(e) => setUtilizationRate(Number(e.target.value))}
                    className="w-full h-2 appearance-none rounded-full bg-slate-200 dark:bg-slate-700 accent-accent cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span>0%</span><span>50%</span><span>100%</span>
                  </div>
                </div>
              </div>

              {/* ── Section: Skills ── */}
              <div>
                <p className="text-[11px] font-semibold text-accent uppercase tracking-widest mb-3 flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5" /> Skills & Expertise
                </p>
                <div className="flex gap-2 mb-3">
                  <input
                    type="text"
                    value={skillInput}
                    onChange={(e) => setSkillInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddSkill() } }}
                    placeholder="Add a skill (press Enter)"
                    className="flex-1 bg-canvas border border-border text-fg text-sm rounded-xl py-2 px-3.5 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all"
                  />
                  <button
                    type="button"
                    onClick={handleAddSkill}
                    className="px-3 py-2 bg-accent hover:bg-accent-hover text-white rounded-xl text-xs font-semibold transition-colors flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add
                  </button>
                </div>
                {skills.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {skills.map((skill, idx) => (
                      <span
                        key={idx}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-accent-soft border border-accent/20 text-[11px] text-accent font-medium"
                      >
                        {skill}
                        <button
                          type="button"
                          onClick={() => handleRemoveSkill(skill)}
                          className="ml-0.5 text-accent hover:text-rose-500 transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted italic">No skills added yet</p>
                )}
              </div>

              {/* ── Section: Bio ── */}
              <div>
                <p className="text-[11px] font-semibold text-accent uppercase tracking-widest mb-3 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" /> About / Bio
                </p>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Short bio or notes about this employee..."
                  rows={3}
                  className="w-full bg-canvas border border-border text-fg text-sm rounded-xl py-2.5 px-3.5 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all resize-none"
                />
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-2 border-t border-border">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => { setShowEditModal(false); setEditingEmployee(null) }}
                  className="w-1/3"
                  disabled={loading}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" className="w-2/3" icon={Edit} disabled={loading}>
                  {loading ? 'Saving Changes...' : 'Save All Changes'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Delete Employee Confirmation Modal */}
      {deleteConfirmEmp && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-md p-6 space-y-4 border-border shadow-2xl relative bg-surface">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="font-bold text-fg text-sm flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-rose-500" /> Confirm Delete Member
              </h3>
              <button
                onClick={() => setDeleteConfirmEmp(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-muted leading-relaxed">
              Are you sure you want to delete <strong className="text-slate-900 dark:text-white">{deleteConfirmEmp.displayName}</strong> ({deleteConfirmEmp.email})? This action cannot be undone.
            </p>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
              <Button variant="secondary" onClick={() => setDeleteConfirmEmp(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  const empId = deleteConfirmEmp.uid || deleteConfirmEmp.employeeId
                  deleteEmployee(empId)
                  await deleteEmployeeFromDb(empId)
                  setDeleteConfirmEmp(null)
                }}
              >
                Yes, Delete Member
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
