import {
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
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../../shared/services/firebaseService'
import { currentCircleId } from '../../../../../shared/supabase/currentCircle.js'

// ─── Fetch all employees ──────────────────────────────────────────────────────
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
    return [{ uid: d.id, employeeId: d.id, ...data }]
  })
}

// ─── Fetch all departments ────────────────────────────────────────────────────
export const getDepartments = async () => {
  const snap = await getDocs(collection(db, 'departments'))
  return snap.docs.map((d) => ({ deptId: d.id, ...d.data() }))
}

// ─── Fetch all leave requests ─────────────────────────────────────────────────
export const getLeaveRequests = async () => {
  try {
    const snap = await getDocs(collection(db, 'leaveRequests'))
    return snap.docs.map((d) => ({ ...d.data(), leaveId: d.id }))
  } catch (err) {
    console.error('Error fetching leave requests from Firestore:', err)
    return []
  }
}

// ─── Create employee ──────────────────────────────────────────────────────────
export const createEmployee = async (employeeData) => {
  const orgId = await currentCircleId()
  if (!orgId) throw new Error('Sign in to a company circle before adding employees.')
  const uid = `emp_${Date.now()}`
  await setDoc(doc(db, 'employees', uid), {
    ...employeeData,
    orgId,
    uid,
    createdAt: serverTimestamp(),
  })
  return { uid, employeeId: uid, orgId, ...employeeData }
}

// ─── Delete employee ──────────────────────────────────────────────────────────
export const deleteEmployeeFromDb = async (uid) => {
  try {
    if (!uid) return
    await deleteDoc(doc(db, 'employees', uid))
  } catch (err) {
    console.error('Error deleting employee from Firestore:', err)
  }
}

// ─── Create leave request ─────────────────────────────────────────────────────
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

// ─── Update leave status ──────────────────────────────────────────────────────
export const updateLeaveStatusInDb = async (leaveId, newStatus, extras = {}) => {
  try {
    await updateDoc(doc(db, 'leaveRequests', leaveId), {
      status: newStatus,
      updatedAt: serverTimestamp(),
      ...extras,
    })
  } catch (err) {
    console.error('Error updating leave status in Firestore:', err)
  }
}

// ─── Permanently delete a leave request ───────────────────────────────────────
export const deleteLeaveRequestFromDb = async (leaveId) => {
  try {
    if (!leaveId) return
    await deleteDoc(doc(db, 'leaveRequests', leaveId))
  } catch (err) {
    console.error('Error deleting leave request from Firestore:', err)
    throw err
  }
}

// ─── Fetch attendance records ─────────────────────────────────────────────────
export const getAttendanceRecords = async () => {
  try {
    const snap = await getDocs(collection(db, 'attendance'))
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  } catch (err) {
    console.error('Error fetching attendance from Firestore:', err)
    return []
  }
}

// ─── Record clock in/out ──────────────────────────────────────────────────────
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

// ─── Fetch company-wide public holidays (read-only for employees) ─────────────
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
 * Subscribe to company holidays with real-time updates (read-only for employees)
 * @param {Function} callback - called with array of holiday objects whenever they change
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

const DEFAULT_OFFICE_LOCATION = {
  lat: null,
  lng: null,
  networkLat: null,
  networkLng: null,
  radiusMeters: 200,
  label: 'Office',
}

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

/** Fetch office geofence (read-only for employees) */
export const getOfficeLocation = async () => {
  try {
    const snap = await getDoc(doc(db, 'companyPolicies', 'officeLocation'))
    if (!snap.exists()) {
      return { ...DEFAULT_OFFICE_LOCATION }
    }
    const raw = snap.data() || {}
    const normalized = normalizeOfficeLocation(raw)
    return normalized
  } catch (err) {
    console.error('Error fetching office location:', err)
    return { ...DEFAULT_OFFICE_LOCATION }
  }
}
