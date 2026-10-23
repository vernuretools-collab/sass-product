import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  sendPasswordResetEmail,
  updateProfile,
} from 'firebase/auth'
import { auth, db, supabase } from './firebaseService'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { ONBOARDING_STATUS, buildDefaultAgreementTexts } from './contractTemplates'
import { normalizeClientUsername, usernameToAuthEmail, isValidClientUsername } from '../../../../shared/supabase/clientLogin.js'

const googleProvider = new GoogleAuthProvider()

/**
 * Sign in with email and password
 */
export const loginWithEmail = async (email, password) => {
  const userCredential = await signInWithEmailAndPassword(auth, email, password)
  return userCredential.user
}

/**
 * Sign up with email, password, and display name
 */
export const signupWithEmail = async (email, password, displayName) => {
  const userCredential = await createUserWithEmailAndPassword(auth, email, password)
  const user = userCredential.user

  if (displayName) {
    await updateProfile(user, { displayName })
  }

  // Create or update user doc in Firestore /users/{uid}
  await ensureUserDocExists(user)

  return user
}

/**
 * Sign in with Google OAuth popup
 */
export const loginWithGoogle = async () => {
  const userCredential = await signInWithPopup(auth, googleProvider)
  const user = userCredential.user
  await ensureUserDocExists(user)
  return user
}

/**
 * Sign out current user
 */
export const logoutUser = async () => {
  await signOut(auth)
}

/**
 * Send password reset email
 */
export const resetPassword = async (email) => {
  await sendPasswordResetEmail(auth, email)
}

/**
 * Fetch fresh ID token result and return decoded custom claims
 */
export const fetchCustomClaims = async (user, forceRefresh = false) => {
  if (!user) return null
  try {
    const tokenResult = await user.getIdTokenResult(forceRefresh)
    return tokenResult.claims || {}
  } catch (err) {
    console.warn('Could not fetch custom claims (mock/offline mode):', err.message)
    return null
  }
}

/**
 * Ensure user document exists in /users/{uid}
 */
export const ensureUserDocExists = async (user, defaultRole = 'owner') => {
  if (!user) return
  if (import.meta.env.VITE_FIREBASE_API_KEY === 'mock_api_key_dev') return

  try {
    const userRef = doc(db, 'users', user.uid)
    const snap = await getDoc(userRef)

    if (!snap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || user.email.split('@')[0],
        photoURL: user.photoURL || null,
        phoneNumber: user.phoneNumber || null,
        role: defaultRole,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        status: 'active',
        invitedBy: null,
        fcmTokens: [],
        notificationPrefs: {
          email: true,
          push: true,
          inApp: true,
        },
        lastSeenAt: serverTimestamp(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        locale: navigator.language || 'en-US',
      })
    } else {
      await setDoc(
        userRef,
        {
          lastSeenAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      )
    }
  } catch (err) {
    console.warn('Firestore offline or dev mock mode active:', err.message)
  }
}

/**
 * Fetch a user document from Firestore /users/{uid} or /employees/{uid}
 */
export const getUserDoc = async (uid) => {
  try {
    const userRef = doc(db, 'users', uid)
    const snap = await getDoc(userRef)
    if (snap.exists()) {
      return snap.data()
    }
    const empRef = doc(db, 'employees', uid)
    const empSnap = await getDoc(empRef)
    if (empSnap.exists()) {
      const data = empSnap.data() || {}
      const role = String(data.role || '').toLowerCase()
      if (role === 'admin' || role === 'owner' || role === 'superadmin') return data
      return { ...data, role: data.role || 'employee' }
    }
  } catch (err) {
    console.warn('Error fetching user document:', err.message)
  }
  return null
}

async function invokeCreateUser(body) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.functions.invoke('create-user', { body })
  if (!error) return data

  let detail = error.message || 'Failed to create the account.'
  try {
    if (error.context && typeof error.context.json === 'function') {
      const payload = await error.context.json()
      detail = payload?.error || payload?.message || detail
    }
  } catch {
    /* the gateway response had no JSON body */
  }
  if (detail === 'Failed to send a request to the Edge Function' || detail === 'Requested function was not found') {
    detail = 'The create-user Edge Function is not deployed on this Supabase project.'
  }
  throw new Error(detail)
}

/**
 * Build the /users and /clientOnboarding records for a new client from the admin form.
 * The onboarding record is seeded up front so the client only has to sign.
 */
const buildClientRecords = (uid, email, payload) => {
  const {
    username,
    displayName,
    companyName,
    phone,
    billingEmail,
    billingAddress,
    taxId,
    paymentMethod,
    signerPhone,
    signatoryTitle,
    dealName,
  } = payload

  const now = new Date().toISOString()
  const loginName = username || email.split('@')[0]

  const clientData = {
    uid,
    username: loginName,
    email,
    displayName: displayName || loginName,
    companyName: companyName || '',
    phoneNumber: phone || null,
    role: 'client',
    tier: 'client',
    status: 'active',
    onboardingStatus: ONBOARDING_STATUS.PENDING_SIGNATURE,
    createdAt: now,
    updatedAt: now,
  }

  const onboardingData = {
    uid,
    username: loginName,
    email,
    displayName: clientData.displayName,
    companyName: companyName || '',
    billingInfo: {
      billingEmail: billingEmail || '',
      billingAddress: billingAddress || '',
      taxId: taxId || '',
      paymentMethod: paymentMethod || 'ach',
      signerPhone: signerPhone || phone || '',
    },
    signatoryTitle: signatoryTitle || 'Authorized Representative',
    dealName: dealName || '',
    agreementTexts: buildDefaultAgreementTexts(),
    agreements: {},
    onboardingStatus: ONBOARDING_STATUS.PENDING_SIGNATURE,
    createdAt: now,
    updatedAt: now,
  }

  return { clientData, onboardingData }
}

/**
 * Programmatically create a Client Auth user & Firestore profile without logging out the active admin.
 * Accepts the full onboarding payload captured by the admin at creation time.
 */
export const createClientAccount = async (payload = {}) => {
  const username = normalizeClientUsername(payload.username)
  const { password } = payload
  if (!isValidClientUsername(username)) {
    throw new Error('Username must be 3–32 characters and use only letters, numbers, dots, underscores, or hyphens.')
  }
  const email = usernameToAuthEmail(username)
  const recordPayload = { ...payload, username }

  if (import.meta.env.VITE_FIREBASE_API_KEY === 'mock_api_key_dev') {
    // Return dummy data in local mock mode
    const mockUid = `client_${Date.now()}`
    const { clientData, onboardingData } = buildClientRecords(mockUid, email, recordPayload)
    await setDoc(doc(db, 'users', mockUid), clientData)
    await setDoc(doc(db, 'clientOnboarding', mockUid), onboardingData)
    return clientData
  }

  const { clientData, onboardingData } = buildClientRecords('pending', email, recordPayload)
  return invokeCreateUser({
    type: 'client',
    username,
    email,
    password,
    displayName: payload.displayName,
    companyName: payload.companyName,
    phone: payload.phone,
    onboardingStatus: clientData.onboardingStatus,
    onboardingData,
  })
}

/** Set a client portal password without sending email. Admin only. */
export const setClientPassword = async (uid, password) => {
  if (!uid) throw new Error('Client account is missing.')
  if (!password || password.length < 8) throw new Error('Password must be at least 8 characters.')
  return invokeCreateUser({
    action: 'set-password',
    type: 'client',
    uid,
    password,
  })
}

/** Remove a client portal login, profile, and onboarding record. Admin only. */
export const deleteClientAccount = async (uid) => {
  if (!uid) throw new Error('Client account is missing.')
  return invokeCreateUser({
    action: 'delete-user',
    type: 'client',
    uid,
  })
}

/**
 * Programmatically create an Employee Auth user & Firestore profile without logging out the active admin.
 */
export const createEmployeeAccount = async (email, password, displayName, roleName, departmentName, phone) => {
  const employeePayload = {
    displayName,
    email,
    roleName: roleName || 'Software Specialist',
    departmentName: departmentName || 'Engineering & Product',
    phoneNumber: phone || ' ',
    skills: ['Productivity'],
    status: 'active',
    joinedAt: new Date().toISOString().split('T')[0],
    utilizationRate: 85,
  }

  if (import.meta.env.VITE_FIREBASE_API_KEY === 'mock_api_key_dev') {
    const mockUid = `emp_${Date.now()}`
    const mockData = {
      uid: mockUid,
      ...employeePayload,
      role: 'employee',
      tier: 'company',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await setDoc(doc(db, 'users', mockUid), mockData)
    await setDoc(doc(db, 'employees', mockUid), mockData)
    return mockData
  }

  return invokeCreateUser({
    type: 'employee',
    email,
    password,
    displayName,
    roleName,
    departmentName,
    phone,
  })
}

/**
 * Programmatically create an Admin Auth user & Firestore profile without logging out the active admin.
 */
export const createAdminAccount = async (email, password, displayName, roleName = 'Executive Admin') => {
  const adminPayload = {
    displayName,
    email,
    roleName: roleName || 'Executive Admin',
    departmentName: 'Executive Management',
    phoneNumber: ' ',
    skills: ['Leadership', 'Management'],
    role: 'admin',
    tier: 'company',
    status: 'active',
    joinedAt: new Date().toISOString().split('T')[0],
  }

  if (import.meta.env.VITE_FIREBASE_API_KEY === 'mock_api_key_dev') {
    const mockUid = `admin_${Date.now()}`
    const mockData = {
      uid: mockUid,
      ...adminPayload,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await setDoc(doc(db, 'users', mockUid), mockData)
    return mockData
  }

  return invokeCreateUser({
    type: 'admin',
    email,
    password,
    displayName,
    roleName,
  })
}
