import {
  onSnapshot,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  setDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../../shared/services/firebaseService'
import { currentCircleId } from '../../../../../shared/supabase/currentCircle.js'
import {
  buildEmployeeMonthlyReport,
  getMonthDateBounds,
  leaveDatesInMonth,
  monthlyReportDocId,
} from './monthlyReportEngine'
import {
  applyLopConversion,
  countUsedPermissionHours,
  expandLeaveWorkingDates,
  formatHoursAsHrsMins,
  hoursBetween,
  isLeaveCountableWorkingDate,
  isPermissionLeave,
  leaveMatchesEmployeeFilter,
  PERMISSION_LEAVE_TYPE,
  resolveLeaveLimits,
  resolvePermissionHours,
  toHolidayDateSet,
} from './leaveEntitlementUtils'

function collectEmployeeIdentityIds(rowId, data = {}) {
  const ids = []
  const seen = new Set()
  const add = (value) => {
    if (value == null || value === '' || typeof value === 'object') return
    const key = String(value)
    if (seen.has(key)) return
    seen.add(key)
    ids.push(key)
  }
  add(rowId)
  add(data.uid)
  add(data.id)
  add(data.employeeId)
  add(data.employeeDocId)
  add(data.auth_id)
  add(data.authId)
  if (Array.isArray(data.identityIds)) data.identityIds.forEach(add)
  return ids
}

/**
 * Fetch all employee profiles from Firestore /employees
 */
function isDirectoryStaff(data = {}) {
  const role = String(data.role || '').toLowerCase()
  return role !== 'owner' && role !== 'admin' && role !== 'superadmin'
}

export const getEmployees = async () => {
  const orgId = await currentCircleId()
  if (!orgId) return []
  const snap = await getDocs(query(collection(db, 'employees'), where('orgId', '==', orgId)))
  return snap.docs.flatMap((d) => {
    const data = d.data() || {}
    if (!isDirectoryStaff(data)) return []
    return [{
      uid: d.id,
      employeeId: d.id,
      ...data,
      employeeDocId: d.id,
      identityIds: collectEmployeeIdentityIds(d.id, data),
    }]
  })
}

/**
 * Fetch all departments from Firestore /departments
 */
export const getDepartments = async () => {
  const snap = await getDocs(collection(db, 'departments'))
  return snap.docs.map((d) => ({ deptId: d.id, ...d.data() }))
}

/**
 * Fetch all leave requests from Firestore /leaveRequests
 */
export const getLeaveRequests = async () => {
  try {
    const snap = await getDocs(collection(db, 'leaveRequests'))
    return snap.docs.map((d) => ({ ...d.data(), leaveId: d.id }))
  } catch (err) {
    console.error('Error fetching leave requests from Firestore:', err)
    return []
  }
}

/**
 * Add a new employee to Firestore
 */
export const createEmployee = async (employeeData) => {
  const orgId = await currentCircleId()
  if (!orgId) throw new Error('Sign in to a company circle before adding employees.')
  try {
    const uid = `emp_${Date.now()}`
    await setDoc(doc(db, 'employees', uid), {
      ...employeeData,
      orgId,
      uid,
      createdAt: serverTimestamp(),
    })
    return { uid, employeeId: uid, orgId, ...employeeData }
  } catch (err) {
    console.error('Error creating employee in Firestore:', err)
    throw err
  }
}

/**
 * Delete an employee from Firestore
 */
export const deleteEmployeeFromDb = async (employeeId) => {
  try {
    if (!employeeId) return
    await deleteDoc(doc(db, 'employees', employeeId))
  } catch (err) {
    console.error('Error deleting employee from Firestore:', err)
  }
}

/**
 * Create a leave request in Firestore /leaveRequests
 * @param {object} leaveData - leave fields; optional status ('pending' | 'approved')
 */
export const createLeaveRequest = async (leaveData) => {
  const requestedStatus = leaveData?.status === 'approved' ? 'approved' : 'pending'
  const { status: _ignored, ...rest } = leaveData || {}
  const leaveId = `leave_${Date.now()}`
  const payload = {
    ...rest,
    leaveId,
    status: requestedStatus,
    createdAt: serverTimestamp(),
  }
  if (requestedStatus === 'approved') {
    payload.autoApproved = rest.autoApproved === true
    payload.reviewedBy = rest.reviewedBy || (rest.autoApproved ? 'WFH Policy' : 'Admin')
    payload.updatedAt = serverTimestamp()
  }
  // Firestore rejects undefined field values
  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined) delete payload[key]
  })
  try {
    await setDoc(doc(db, 'leaveRequests', leaveId), payload)
    return { ...payload, createdAt: new Date().toISOString() }
  } catch (err) {
    console.error('Error creating leave request in Firestore:', err)
    throw err
  }
}

/**
 * Expand inclusive YYYY-MM-DD date range into an array of date strings.
 */
const expandDateRange = (startDate, endDate) => {
  const dates = []
  if (!startDate) return dates
  const start = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${(endDate || startDate)}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return dates

  const cursor = new Date(start)
  while (cursor <= end) {
    const y = cursor.getFullYear()
    const m = String(cursor.getMonth() + 1).padStart(2, '0')
    const d = String(cursor.getDate()).padStart(2, '0')
    dates.push(`${y}-${m}-${d}`)
    cursor.setDate(cursor.getDate() + 1)
  }
  return dates
}

/**
 * Resolve employee uid for an On Duty leave request (employeeId, email, or name).
 */
const resolveEmployeeUidForLeave = async (leaveData) => {
  if (leaveData?.employeeId) return leaveData.employeeId

  try {
    const employees = await getEmployees()

    if (leaveData?.employeeEmail) {
      const byEmail = employees.find(
        (e) => e.email?.toLowerCase() === leaveData.employeeEmail.toLowerCase()
      )
      if (byEmail) return byEmail.uid
    }

    if (leaveData?.employeeName && leaveData.employeeName !== 'Team Staff') {
      const byName = employees.find(
        (e) =>
          e.displayName?.toLowerCase() === leaveData.employeeName.toLowerCase() ||
          e.name?.toLowerCase() === leaveData.employeeName.toLowerCase()
      )
      if (byName) return byName.uid
    }
  } catch (err) {
    console.error('Error resolving employee uid for On Duty:', err)
  }
  return null
}

/**
 * Mark attendance Present for each date covered by an approved On Duty request.
 * Writes/merges attendanceLogs/{date}_{uid} with onDuty flags (does not set clockedIn).
 */
export const markOnDutyAttendance = async (leaveData) => {
  if (!leaveData || leaveData.leaveType !== 'On Duty') return

  const uid = await resolveEmployeeUidForLeave(leaveData)
  if (!uid) {
    console.error('Cannot mark On Duty attendance: missing employee uid', leaveData)
    return
  }

  const dates = expandDateRange(leaveData.startDate, leaveData.endDate)
  if (dates.length === 0) return

  try {
    await Promise.all(
      dates.map((date) => {
        const docId = `${date}_${uid}`
        return setDoc(
          doc(db, 'attendanceLogs', docId),
          {
            uid,
            date,
            docId,
            onDuty: true,
            present: true,
            source: 'on_duty',
            leaveId: leaveData.leaveId || null,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        )
      })
    )
  } catch (err) {
    console.error('Error marking On Duty attendance in Firestore:', err)
  }
}

/**
 * Admin toggle: mark an employee Present or Absent for a given date (defaults to today).
 * Writes attendanceLogs/{date}_{uid}.
 */
export const setEmployeeAttendanceStatus = async (employee, isPresent, dateStr) => {
  const uid = employee?.uid || employee?.employeeId || employee?.id
  if (!uid) throw new Error('Missing employee uid')

  const date = dateStr || new Date().toISOString().split('T')[0]
  const docId = `${date}_${uid}`
  const displayName = employee.displayName || employee.name || 'Employee'
  const departmentName = employee.departmentName || employee.department || 'General'

  if (isPresent) {
    const clockInTime = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
    await setDoc(
      doc(db, 'attendanceLogs', docId),
      {
        uid,
        date,
        docId,
        displayName,
        departmentName,
        present: true,
        clockedIn: true,
        onDuty: false,
        clockInTime,
        clockInTimestamp: Date.now(),
        clockOutTime: null,
        source: 'admin_toggle',
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    )
  } else {
    await setDoc(
      doc(db, 'attendanceLogs', docId),
      {
        uid,
        date,
        docId,
        displayName,
        departmentName,
        present: false,
        clockedIn: false,
        onDuty: false,
        clockInTime: null,
        clockInTimestamp: null,
        clockOutTime: null,
        regularSeconds: 0,
        regularHours: '0h',
        source: 'admin_toggle',
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    )
  }

  return { uid, date, isPresent }
}

/**
 * Update leave request status in Firestore
 * @param {string} leaveId - The leave request document ID
 * @param {string} newStatus - 'approved' | 'rejected'
 * @param {string} reviewedBy - Display name of the admin who actioned the request
 */
export const updateLeaveStatusInDb = async (leaveId, newStatus, reviewedBy) => {
  try {
    const patch = {
      status: newStatus,
      reviewedBy: reviewedBy || 'Admin',
      updatedAt: serverTimestamp(),
    }

    if (newStatus === 'approved') {
      const leaveSnap = await getDoc(doc(db, 'leaveRequests', leaveId))
      if (leaveSnap.exists()) {
        const leaveData = { leaveId, ...leaveSnap.data() }
        const [empSnap, leavesSnap, holidays] = await Promise.all([
          leaveData.employeeId
            ? getDoc(doc(db, 'employees', leaveData.employeeId))
            : Promise.resolve(null),
          getDocs(collection(db, 'leaveRequests')),
          getCompanyHolidays(),
        ])
        const emp = empSnap?.exists() ? { uid: empSnap.id, ...empSnap.data() } : {}
        const conversion = applyLopConversion({
          requestedType: leaveData.requestedLeaveType || leaveData.leaveType,
          startDate: leaveData.startDate,
          endDate: leaveData.endDate,
          days: leaveData.days,
          leaveRequests: leavesSnap.docs.map((d) => ({ ...d.data(), leaveId: d.id })),
          employeeFilter: {
            employeeId: leaveData.employeeId,
            employeeEmail: leaveData.employeeEmail,
            employeeName: leaveData.employeeName,
          },
          limits: resolveLeaveLimits(emp),
          excludeLeaveId: leaveId,
          holidays,
        })
        patch.leaveType = conversion.leaveType
        patch.requestedLeaveType = conversion.requestedLeaveType
        patch.convertedToLop = conversion.convertedToLop
        leaveData.leaveType = conversion.leaveType
        if (leaveData.leaveType === 'On Duty') {
          await markOnDutyAttendance(leaveData)
        }
      }
    }

    await updateDoc(doc(db, 'leaveRequests', leaveId), patch)
  } catch (err) {
    console.error('Error updating leave status in Firestore:', err)
  }
}

/**
 * Clear On Duty attendance marks written for a leave request.
 */
const clearOnDutyAttendanceForLeave = async (leaveData) => {
  if (!leaveData || leaveData.leaveType !== 'On Duty') return

  const uid = await resolveEmployeeUidForLeave(leaveData)
  if (!uid) return

  const dates = expandDateRange(leaveData.startDate, leaveData.endDate)
  if (dates.length === 0) return

  try {
    await Promise.all(
      dates.map(async (date) => {
        const docId = `${date}_${uid}`
        const ref = doc(db, 'attendanceLogs', docId)
        const snap = await getDoc(ref)
        if (!snap.exists()) return
        const data = snap.data() || {}
        // Only clear marks created by this On Duty leave (or legacy on_duty with matching leaveId)
        const leaveId = leaveData.leaveId || leaveData.id
        if (data.source !== 'on_duty') return
        if (data.leaveId && leaveId && data.leaveId !== leaveId) return
        await setDoc(
          ref,
          {
            onDuty: false,
            leaveId: null,
            updatedAt: serverTimestamp(),
            // Keep real clock-in presence; only drop pure On Duty marks
            ...(data.clockedIn ||
            (data.clockInTime && data.clockInTime !== '—') ||
            (Number(data.regularSeconds) || 0) > 0
              ? { source: data.source === 'on_duty' ? 'clock' : data.source || 'clock' }
              : { present: false, source: 'on_duty_revoked' }),
          },
          { merge: true }
        )
      })
    )
  } catch (err) {
    console.error('Error clearing On Duty attendance after leave revoke:', err)
  }
}

const shiftYmd = (dateStr, deltaDays) => {
  const cursor = new Date(`${dateStr}T00:00:00`)
  cursor.setDate(cursor.getDate() + deltaDays)
  const y = cursor.getFullYear()
  const m = String(cursor.getMonth() + 1).padStart(2, '0')
  const d = String(cursor.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const leaveRange = (leave) => {
  const start = String(leave?.startDate || '').slice(0, 10)
  const end = String(leave?.endDate || leave?.startDate || '').slice(0, 10)
  return { start, end }
}

const isActiveLeaveStatus = (leave) => {
  const status = String(leave?.status || '').toLowerCase()
  return status !== 'rejected' && status !== 'cancelled'
}

const isOnDutyLeave = (leave) =>
  leave?.leaveType === 'On Duty' || leave?.requestedLeaveType === 'On Duty'

const rangeDayCount = (leave, start, end, holidays) => {
  if (isPermissionLeave(leave)) return 0
  return expandLeaveWorkingDates(start, end, holidays).length
}

const cloneLeaveFields = (leave) => {
  const out = {
    employeeName: leave.employeeName || '',
    employeeId: leave.employeeId || '',
    employeeEmail: leave.employeeEmail || '',
    leaveType: leave.leaveType,
    requestedLeaveType: leave.requestedLeaveType || leave.leaveType,
    convertedToLop: Boolean(leave.convertedToLop),
    reason: leave.reason || '',
    status: leave.status || 'approved',
    autoApproved: leave.autoApproved === true,
    reviewedBy: leave.reviewedBy || 'Admin',
  }
  if (leave.startTime) out.startTime = leave.startTime
  if (leave.endTime) out.endTime = leave.endTime
  if (leave.hours != null && leave.hours !== '') out.hours = leave.hours
  return out
}

const newLeaveId = () => `leave_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

/**
 * Drop one date from a leave request. A single-day request is deleted.
 * A longer range is split so the other dates stay.
 */
const excludeDateFromLeave = async (leave, date, holidays) => {
  const leaveId = leave?.leaveId || leave?.id
  const { start, end } = leaveRange(leave)
  if (!leaveId || !start || date < start || date > end) return

  if (isOnDutyLeave(leave)) {
    await clearOnDutyAttendanceForLeave({ ...leave, leaveId, startDate: start, endDate: end })
  }

  const beforeEnd = shiftYmd(date, -1)
  const afterStart = shiftYmd(date, 1)
  const hasBefore = start <= beforeEnd
  const hasAfter = afterStart <= end

  if (!hasBefore && !hasAfter) {
    await deleteDoc(doc(db, 'leaveRequests', leaveId))
    return
  }

  const base = cloneLeaveFields(leave)
  if (hasBefore) {
    const days = rangeDayCount(leave, start, beforeEnd, holidays)
    await updateDoc(doc(db, 'leaveRequests', leaveId), {
      startDate: start,
      endDate: beforeEnd,
      days,
      updatedAt: serverTimestamp(),
    })
    if (isOnDutyLeave(leave)) {
      await markOnDutyAttendance({
        ...base,
        leaveId,
        leaveType: 'On Duty',
        startDate: start,
        endDate: beforeEnd,
      })
    }
  }

  if (hasAfter) {
    const days = rangeDayCount(leave, afterStart, end, holidays)
    if (!hasBefore) {
      await updateDoc(doc(db, 'leaveRequests', leaveId), {
        startDate: afterStart,
        endDate: end,
        days,
        updatedAt: serverTimestamp(),
      })
      if (isOnDutyLeave(leave)) {
        await markOnDutyAttendance({
          ...base,
          leaveId,
          leaveType: 'On Duty',
          startDate: afterStart,
          endDate: end,
        })
      }
      return
    }

    const splitId = newLeaveId()
    await setDoc(doc(db, 'leaveRequests', splitId), {
      ...base,
      leaveId: splitId,
      startDate: afterStart,
      endDate: end,
      days,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    if (isOnDutyLeave(leave)) {
      await markOnDutyAttendance({
        ...base,
        leaveId: splitId,
        leaveType: 'On Duty',
        startDate: afterStart,
        endDate: end,
      })
    }
  }
}

const employeeLeaveFilter = (employee) => {
  const uid = employee?.uid || employee?.employeeId || employee?.id || ''
  return {
    employeeId: uid,
    uid,
    employeeEmail: employee?.email || '',
    employeeName: employee?.displayName || employee?.name || '',
  }
}

const coveringLeavesForDate = (leaveRequests, employee, date) => {
  const filter = employeeLeaveFilter(employee)
  return (leaveRequests || []).filter((leave) => {
    if (!isActiveLeaveStatus(leave)) return false
    if (!leaveMatchesEmployeeFilter(leave, filter)) return false
    const { start, end } = leaveRange(leave)
    return Boolean(start) && date >= start && date <= end
  })
}

/**
 * Permanently delete a leave request from the database.
 * Clears On Duty attendance marks written for that request.
 */
export const deleteLeaveRequestFromDb = async (leaveId) => {
  if (!leaveId) return
  const ref = doc(db, 'leaveRequests', leaveId)
  try {
    const snap = await getDoc(ref)
    if (snap.exists()) {
      const leaveData = { leaveId, ...snap.data() }
      await clearOnDutyAttendanceForLeave(leaveData)
    }
    await deleteDoc(ref)
  } catch (err) {
    console.error('Error deleting leave request from database:', err)
    throw err
  }
}

/**
 * Set, change, or clear one calendar day of leave for one employee.
 * Past dates are allowed. A multi-day request that covers the date is split
 * so only that day changes. Empty leaveType removes leave on that date.
 */
export const assignEmployeeDayLeave = async ({
  employee,
  date,
  leaveType = '',
  reason = '',
  startTime = '',
  endTime = '',
  reviewedBy = 'Admin',
} = {}) => {
  const day = String(date || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Choose a valid date.')
  const uid = employee?.uid || employee?.employeeId || employee?.id || ''
  if (!uid && !employee?.email) throw new Error('Select an employee first.')

  const holidays = await getCompanyHolidays()
  const all = await getLeaveRequests()
  const filter = employeeLeaveFilter(employee)
  const covering = coveringLeavesForDate(all, employee, day)
  const clearing = !String(leaveType || '').trim()

  if (clearing) {
    for (const leave of covering) {
      await excludeDateFromLeave(leave, day, holidays)
    }
    return { cleared: true, date: day }
  }

  if (!isLeaveCountableWorkingDate(day, toHolidayDateSet(holidays))) {
    throw new Error('That date is a Sunday or a company holiday. Pick a working day.')
  }

  const permission = leaveType === PERMISSION_LEAVE_TYPE
  const targets = covering.filter((leave) => isPermissionLeave(leave) === permission)
  const exact = targets.find((leave) => {
    const { start, end } = leaveRange(leave)
    return start === day && end === day
  })

  let permissionHours = 0
  if (permission) {
    if (!startTime || !endTime) {
      throw new Error('Please select a start time and end time for Permission.')
    }
    permissionHours = hoursBetween(startTime, endTime)
    if (permissionHours <= 0) throw new Error('End time must be after start time.')
    const used = countUsedPermissionHours(all, filter, day.slice(0, 7), {
      excludeLeaveId: exact?.leaveId || exact?.id,
    })
    const limit = resolvePermissionHours(employee)
    const remaining = Math.max(0, Math.round((limit - used) * 100) / 100)
    if (permissionHours > remaining + 1e-9) {
      throw new Error(
        remaining <= 0
          ? `No Permission hours remaining this month (${formatHoursAsHrsMins(limit)}).`
          : `This request is ${formatHoursAsHrsMins(permissionHours)}. Only ${formatHoursAsHrsMins(remaining)} remaining this month.`
      )
    }
  }

  for (const leave of targets) {
    const id = leave.leaveId || leave.id
    if (exact && id === (exact.leaveId || exact.id)) continue
    await excludeDateFromLeave(leave, day, holidays)
  }

  const daysCount = permission ? 0 : expandLeaveWorkingDates(day, day, holidays).length || 1
  const conversion = permission
    ? {
        leaveType: PERMISSION_LEAVE_TYPE,
        requestedLeaveType: PERMISSION_LEAVE_TYPE,
        convertedToLop: false,
      }
    : applyLopConversion({
        requestedType: leaveType,
        startDate: day,
        endDate: day,
        days: daysCount,
        leaveRequests: all,
        employeeFilter: filter,
        limits: resolveLeaveLimits(employee),
        excludeLeaveId: exact?.leaveId || exact?.id,
        holidays,
      })

  const payload = {
    employeeName: employee?.displayName || employee?.name || filter.employeeName || '',
    employeeId: uid,
    employeeEmail: employee?.email || '',
    leaveType: conversion.leaveType,
    requestedLeaveType: conversion.requestedLeaveType,
    convertedToLop: conversion.convertedToLop,
    startDate: day,
    endDate: day,
    days: daysCount,
    reason: reason || `${leaveType} set by admin`,
    status: 'approved',
    autoApproved: true,
    reviewedBy: reviewedBy || 'Admin',
    updatedAt: serverTimestamp(),
    startTime: permission ? startTime : null,
    endTime: permission ? endTime : null,
    hours: permission ? permissionHours : null,
  }

  if (exact) {
    const leaveId = exact.leaveId || exact.id
    if (isOnDutyLeave(exact) && payload.leaveType !== 'On Duty') {
      await clearOnDutyAttendanceForLeave({ ...exact, leaveId, startDate: day, endDate: day })
    }
    await updateDoc(doc(db, 'leaveRequests', leaveId), payload)
    if (payload.leaveType === 'On Duty') {
      await markOnDutyAttendance({ ...payload, leaveId, leaveType: 'On Duty' })
    }
    return { leaveId, ...payload, updatedAt: new Date().toISOString() }
  }

  const created = await createLeaveRequest(payload)
  if (created.leaveType === 'On Duty') {
    await markOnDutyAttendance(created)
  }
  return created
}

/**
 * Fetch attendance logs from Firestore /attendance
 */
export const getAttendanceRecords = async () => {
  try {
    const snap = await getDocs(collection(db, 'attendance'))
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  } catch (err) {
    console.error('Error fetching attendance from Firestore:', err)
    return []
  }
}

/**
 * Record clock in/out in Firestore
 */
export const recordAttendanceInDb = async (attendanceData) => {
  try {
    const docRef = await addDoc(collection(db, 'attendance'), {
      ...attendanceData,
      timestamp: serverTimestamp(),
    })
    return { id: docRef.id, ...attendanceData }
  } catch (err) {
    console.error('Error recording attendance in Firestore:', err)
    return { id: `att_${Date.now()}`, ...attendanceData }
  }
}

/**
 * Add a new department to Firestore
 */
export const createDepartment = async (name) => {
  try {
    const docRef = await addDoc(collection(db, 'departments'), { name })
    return { deptId: docRef.id, name }
  } catch (err) {
    console.error('Error creating department in Firestore:', err)
    return { deptId: `dept_${Date.now()}`, name }
  }
}

/**
 * Update an employee profile in Firestore (both /employees and /users collections)
 */
export const updateEmployeeInDb = async (uid, data) => {
  try {
    if (!uid) return
    const empRef = doc(db, 'employees', uid)
    const userRef = doc(db, 'users', uid)
    await updateDoc(empRef, data)
    try {
      await updateDoc(userRef, data)
    } catch {
      // users doc may not exist for every employee
    }
  } catch (err) {
    console.error('Error updating employee in Firestore:', err)
  }
}

/**
 * Save per-employee WFH policy fields on /employees/{uid}
 */
export const saveEmployeeWfhPolicy = async (uid, { wfhMode, wfhLimit, leaveLimits }, updatedBy) => {
  const mode = ['off', 'full', 'weekly', 'monthly'].includes(wfhMode) ? wfhMode : 'off'
  const limit = Math.max(1, Number(wfhLimit) || 1)
  const casual = Math.max(0, Math.floor(Number(leaveLimits?.casual) || 0))
  const sick = Math.max(0, Math.floor(Number(leaveLimits?.sick) || 0))
  const wfh = Math.max(0, Math.floor(Number(leaveLimits?.wfh) || 0))
  const data = {
    wfhMode: mode,
    wfhLimit: mode === 'weekly' || mode === 'monthly' ? limit : 0,
    leaveLimits: { casual, sick, wfh },
    wfhUpdatedBy: updatedBy || 'Admin',
    wfhUpdatedAt: serverTimestamp(),
  }
  await updateEmployeeInDb(uid, data)
  return data
}

/**
 * Fetch all company-wide holidays from Firestore /companyHolidays
 */
export const getCompanyHolidays = async () => {
  try {
    const snap = await getDocs(collection(db, 'companyHolidays'))
    return snap.docs.map((d) => ({ holidayId: d.id, ...d.data() }))
  } catch (err) {
    console.error('Error fetching company holidays from Firestore:', err)
    return []
  }
}

/**
 * Subscribe to company holidays with real-time updates
 * @param {Function} callback - called with array of holiday objects
 * @returns unsubscribe function
 */
export const subscribeToCompanyHolidays = (callback) => {
  return onSnapshot(
    collection(db, 'companyHolidays'),
    (snap) => {
      const list = snap.docs.map((d) => ({ holidayId: d.id, ...d.data() }))
      callback(list)
    },
    (err) => {
      console.error('Error listening to company holidays:', err)
      callback([])
    }
  )
}

/**
 * Create a new company holiday in Firestore /companyHolidays
 * @param {string} date - "YYYY-MM-DD"
 * @param {string} name - Holiday label e.g. "Diwali"
 * @param {string} createdBy - Admin display name
 */
export const createCompanyHoliday = async (date, name, createdBy) => {
  try {
    const holidayId = `holiday_${Date.now()}`
    await setDoc(doc(db, 'companyHolidays', holidayId), {
      holidayId,
      date,
      name: name || 'Holiday',
      createdBy: createdBy || 'Admin',
      createdAt: serverTimestamp(),
    })
    return { holidayId, date, name: name || 'Holiday', createdBy: createdBy || 'Admin' }
  } catch (err) {
    console.error('Error creating company holiday in Firestore:', err)
    const holidayId = `holiday_${Date.now()}`
    return { holidayId, date, name: name || 'Holiday', createdBy: createdBy || 'Admin' }
  }
}

/**
 * Delete a company holiday from Firestore /companyHolidays
 * @param {string} holidayId - Document ID
 */
export const deleteCompanyHoliday = async (holidayId) => {
  try {
    if (!holidayId) return
    await deleteDoc(doc(db, 'companyHolidays', holidayId))
  } catch (err) {
    console.error('Error deleting company holiday from Firestore:', err)
  }
}

/**
 * Update a company holiday's name and/or date.
 * @param {string} holidayId
 * @param {{ date?: string, name?: string }} patch
 */
export const updateCompanyHoliday = async (holidayId, { date, name } = {}) => {
  try {
    if (!holidayId) return
    const patch = { updatedAt: serverTimestamp() }
    if (date) patch.date = date
    if (name != null) patch.name = String(name).trim() || 'Holiday'
    await updateDoc(doc(db, 'companyHolidays', holidayId), patch)
    return { holidayId, ...patch }
  } catch (err) {
    console.error('Error updating company holiday in Firestore:', err)
    throw err
  }
}

/**
 * Default WFH policy when Firestore doc is missing
 */
export const DEFAULT_WFH_POLICY = {
  enabled: true,
  mode: 'monthly',
  limit: 2,
}

/**
 * Normalize raw Firestore WFH policy data
 */
export const normalizeWfhPolicy = (data) => {
  const mode = ['weekly', 'monthly', 'unlimited'].includes(data?.mode)
    ? data.mode
    : DEFAULT_WFH_POLICY.mode
  const limit = Math.max(1, Number(data?.limit) || DEFAULT_WFH_POLICY.limit)
  return {
    enabled: data?.enabled !== false,
    mode,
    limit,
    updatedBy: data?.updatedBy || null,
    updatedAt: data?.updatedAt || null,
  }
}

/**
 * Fetch company WFH policy from Firestore /companyPolicies/wfh
 */
export const getWfhPolicy = async () => {
  try {
    const snap = await getDoc(doc(db, 'companyPolicies', 'wfh'))
    if (!snap.exists()) return { ...DEFAULT_WFH_POLICY }
    return normalizeWfhPolicy(snap.data())
  } catch (err) {
    console.error('Error fetching WFH policy from Firestore:', err)
    return { ...DEFAULT_WFH_POLICY }
  }
}

/**
 * Subscribe to company WFH policy with real-time updates
 * @param {Function} callback - called with normalized policy object
 * @returns unsubscribe function
 */
export const subscribeToWfhPolicy = (callback) => {
  return onSnapshot(
    doc(db, 'companyPolicies', 'wfh'),
    (snap) => {
      if (!snap.exists()) {
        callback({ ...DEFAULT_WFH_POLICY })
        return
      }
      callback(normalizeWfhPolicy(snap.data()))
    },
    (err) => {
      console.error('Error listening to WFH policy:', err)
      callback({ ...DEFAULT_WFH_POLICY })
    }
  )
}

/**
 * Save company WFH policy to Firestore /companyPolicies/wfh
 * @param {{ enabled: boolean, mode: string, limit: number }} policy
 * @param {string} updatedBy - Admin display name
 */
export const saveWfhPolicy = async (policy, updatedBy) => {
  const normalized = normalizeWfhPolicy(policy)
  const payload = {
    enabled: Boolean(normalized.enabled),
    mode: normalized.mode,
    limit: normalized.mode === 'unlimited' ? normalized.limit : Math.max(1, Number(normalized.limit) || 1),
    updatedBy: updatedBy || 'Admin',
    updatedAt: serverTimestamp(),
  }
  try {
    await setDoc(doc(db, 'companyPolicies', 'wfh'), payload, { merge: true })
    return { ...payload, updatedAt: new Date().toISOString() }
  } catch (err) {
    console.error('Error saving WFH policy to Firestore:', err)
    return payload
  }
}

const DEFAULT_OFFICE_LOCATION = {
  lat: null,
  lng: null,
  networkLat: null,
  networkLng: null,
  radiusMeters: 200,
  label: 'Office',
}

/**
 * Normalize office location document
 */
export const normalizeOfficeLocation = (data) => {
  const lat = data?.lat != null ? Number(data.lat) : null
  const lng = data?.lng != null ? Number(data.lng) : null
  const networkLat = data?.networkLat != null ? Number(data.networkLat) : null
  const networkLng = data?.networkLng != null ? Number(data.networkLng) : null
  const radiusMeters = Math.max(50, Number(data?.radiusMeters) || DEFAULT_OFFICE_LOCATION.radiusMeters)
  return {
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    networkLat: Number.isFinite(networkLat) ? networkLat : null,
    networkLng: Number.isFinite(networkLng) ? networkLng : null,
    radiusMeters,
    label: data?.label || 'Office',
    updatedBy: data?.updatedBy || null,
    updatedAt: data?.updatedAt || null,
  }
}

/**
 * Fetch office geofence from Firestore /companyPolicies/officeLocation
 */
export const getOfficeLocation = async () => {
  try {
    const snap = await getDoc(doc(db, 'companyPolicies', 'officeLocation'))
    if (!snap.exists()) return { ...DEFAULT_OFFICE_LOCATION }
    return normalizeOfficeLocation(snap.data())
  } catch (err) {
    console.error('Error fetching office location:', err)
    return { ...DEFAULT_OFFICE_LOCATION }
  }
}

/**
 * Subscribe to office location changes
 */
export const subscribeToOfficeLocation = (callback) => {
  return onSnapshot(
    doc(db, 'companyPolicies', 'officeLocation'),
    (snap) => {
      if (!snap.exists()) {
        callback({ ...DEFAULT_OFFICE_LOCATION })
        return
      }
      callback(normalizeOfficeLocation(snap.data()))
    },
    (err) => {
      console.error('Error listening to office location:', err)
      callback({ ...DEFAULT_OFFICE_LOCATION })
    }
  )
}

/**
 * Save office geofence to Firestore /companyPolicies/officeLocation
 */
export const saveOfficeLocation = async ({ lat, lng, radiusMeters, label, networkLat, networkLng }, updatedBy) => {
  const normalized = normalizeOfficeLocation({ lat, lng, radiusMeters, label, networkLat, networkLng })
  const payload = {
    lat: normalized.lat,
    lng: normalized.lng,
    radiusMeters: normalized.radiusMeters,
    label: normalized.label || 'Office',
    updatedBy: updatedBy || 'Admin',
    updatedAt: serverTimestamp(),
  }
  if (normalized.networkLat != null && normalized.networkLng != null) {
    payload.networkLat = normalized.networkLat
    payload.networkLng = normalized.networkLng
  }
  try {
    await setDoc(doc(db, 'companyPolicies', 'officeLocation'), payload, { merge: true })
    return { ...payload, updatedAt: new Date().toISOString() }
  } catch (err) {
    console.error('Error saving office location:', err)
    return payload
  }
}

/**
 * Fetch daily idle rows whose date falls within a calendar month (YYYY-MM).
 * @param {string} month
 * @returns {Promise<object[]>}
 */
export const getWorkIdleForMonth = async (month) => {
  const { start, end } = getMonthDateBounds(month)
  try {
    const q = query(
      collection(db, 'workIdleDays'),
      where('date', '>=', start),
      where('date', '<=', end)
    )
    const snap = await getDocs(q)
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  } catch (err) {
    console.error('Error fetching work idle for month:', err)
    try {
      const snap = await getDocs(collection(db, 'workIdleDays'))
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((row) => row.date && row.date >= start && row.date <= end)
    } catch (fallbackErr) {
      console.error('Fallback work idle month fetch failed:', fallbackErr)
      return []
    }
  }
}

export const getAttendanceLogsForMonth = async (month) => {
  const { start, end } = getMonthDateBounds(month)
  try {
    const q = query(
      collection(db, 'attendanceLogs'),
      where('date', '>=', start),
      where('date', '<=', end)
    )
    const snap = await getDocs(q)
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  } catch (err) {
    console.error('Error fetching attendance logs for month:', err)
    // Fallback: full scan + client filter (avoids composite-index failures)
    try {
      const snap = await getDocs(collection(db, 'attendanceLogs'))
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((log) => log.date && log.date >= start && log.date <= end)
    } catch (fallbackErr) {
      console.error('Fallback attendance month fetch failed:', fallbackErr)
      return []
    }
  }
}

/**
 * Leave requests that overlap a calendar month.
 * @param {string} month
 * @returns {Promise<object[]>}
 */
export const getLeaveRequestsForMonth = async (month) => {
  const { start, end } = getMonthDateBounds(month)
  try {
    const all = await getLeaveRequests()
    return (all || []).filter((leave) => leaveDatesInMonth(leave, month).length > 0 || (
      leave.startDate && leave.startDate <= end && (leave.endDate || leave.startDate) >= start
    ))
  } catch (err) {
    console.error('Error fetching leave requests for month:', err)
    return []
  }
}

/**
 * Fetch work timeline entries overlapping a month (optionally for one uid).
 * @param {string} month
 * @param {string} [uid]
 * @returns {Promise<object[]>}
 */
export const getTimelineEntriesForMonth = async (month, uid = null) => {
  const { start, end } = getMonthDateBounds(month)
  try {
    let snap
    if (uid) {
      const q = query(collection(db, 'workTimelineEntries'), where('uid', '==', uid))
      snap = await getDocs(q)
    } else {
      snap = await getDocs(collection(db, 'workTimelineEntries'))
    }
    return snap.docs
      .map((d) => ({ entryId: d.id, ...d.data() }))
      .filter((e) => e.date && e.date >= start && e.date <= end)
  } catch (err) {
    console.error('Error fetching timeline entries for month:', err)
    return []
  }
}

/**
 * Read a stored monthly report snapshot.
 * @param {string} uid
 * @param {string} month
 * @returns {Promise<object|null>}
 */
export const getMonthlyReport = async (uid, month) => {
  if (!uid || !month) return null
  try {
    const docId = monthlyReportDocId(uid, month)
    const snap = await getDoc(doc(db, 'employeeMonthlyReports', docId))
    if (!snap.exists()) return null
    return { id: snap.id, ...snap.data() }
  } catch (err) {
    console.error('Error fetching monthly report:', err)
    return null
  }
}

/**
 * List stored monthly reports for a month (all employees).
 * @param {{ month: string }} opts
 * @returns {Promise<object[]>}
 */
export const listMonthlyReports = async ({ month } = {}) => {
  try {
    if (month) {
      const q = query(collection(db, 'employeeMonthlyReports'), where('month', '==', month))
      const snap = await getDocs(q)
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    }
    const snap = await getDocs(collection(db, 'employeeMonthlyReports'))
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  } catch (err) {
    console.error('Error listing monthly reports:', err)
    return []
  }
}

/**
 * Persist a monthly report snapshot.
 * @param {object} report
 * @returns {Promise<object>}
 */
export const saveMonthlyReport = async (report) => {
  if (!report?.uid || !report?.month) {
    throw new Error('saveMonthlyReport requires uid and month')
  }
  const docId = monthlyReportDocId(report.uid, report.month)
  const payload = {
    ...report,
    docId,
    updatedAt: serverTimestamp(),
  }
  try {
    await setDoc(doc(db, 'employeeMonthlyReports', docId), payload, { merge: true })
    return { id: docId, ...report, docId }
  } catch (err) {
    console.error('Error saving monthly report:', err)
    throw err
  }
}

/**
 * Aggregate live data for one employee-month and save the snapshot.
 * @param {object} employee
 * @param {string} month
 * @param {string} [generatedBy]
 * @param {object} [preloaded] - optional shared month datasets
 * @returns {Promise<object>}
 */
export const generateEmployeeMonthlyReport = async (
  employee,
  month,
  generatedBy = 'Admin',
  preloaded = null
) => {
  const uid = employee?.uid || employee?.employeeId || employee?.id
  if (!uid || !month) throw new Error('generateEmployeeMonthlyReport requires employee uid and month')

  const [attendanceLogs, leaveRequests, timelineEntries, holidays, idleDays] = await Promise.all([
    preloaded?.attendanceLogs
      ? Promise.resolve(preloaded.attendanceLogs.filter((l) => !l.uid || String(l.uid) === String(uid)))
      : getAttendanceLogsForMonth(month).then((logs) =>
          logs.filter((l) => !l.uid || String(l.uid) === String(uid))
        ),
    preloaded?.leaveRequests
      ? Promise.resolve(preloaded.leaveRequests)
      : getLeaveRequestsForMonth(month),
    preloaded?.timelineEntries
      ? Promise.resolve(
          preloaded.timelineEntries.filter((e) => !e.uid || String(e.uid) === String(uid))
        )
      : getTimelineEntriesForMonth(month, uid),
    preloaded?.holidays ? Promise.resolve(preloaded.holidays) : getCompanyHolidays(),
    preloaded?.idleDays ? Promise.resolve(preloaded.idleDays) : getWorkIdleForMonth(month),
  ])

  const report = buildEmployeeMonthlyReport({
    employee,
    month,
    attendanceLogs,
    leaveRequests,
    timelineEntries,
    holidays,
    idleDays,
    generatedBy,
  })

  return saveMonthlyReport(report)
}

/**
 * Generate & store monthly reports for all employees for a given month.
 * @param {string} month
 * @param {string} [generatedBy]
 * @returns {Promise<object[]>}
 */
export const generateAllEmployeesMonthlyReports = async (month, generatedBy = 'Admin') => {
  let employees = []
  try {
    employees = await getEmployees()
  } catch (err) {
    console.error('Error fetching employees for monthly reports:', err)
    return []
  }

  const [attendanceLogs, leaveRequests, timelineEntries, holidays, idleDays] = await Promise.all([
    getAttendanceLogsForMonth(month),
    getLeaveRequestsForMonth(month),
    getTimelineEntriesForMonth(month),
    getCompanyHolidays(),
    getWorkIdleForMonth(month),
  ])

  const preloaded = { attendanceLogs, leaveRequests, timelineEntries, holidays, idleDays }
  const results = []
  for (const emp of employees || []) {
    try {
      const report = await generateEmployeeMonthlyReport(emp, month, generatedBy, preloaded)
      results.push(report)
    } catch (err) {
      console.error('Failed generating report for employee:', emp?.uid || emp?.email, err)
    }
  }
  return results
}
