import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  sendPasswordResetEmail,
  updateProfile,
} from 'firebase/auth'
import { auth, db } from './firebaseService'
import { collection, doc, getDoc, getDocs, setDoc, serverTimestamp } from 'firebase/firestore'

const googleProvider = new GoogleAuthProvider()

/**
 * Sign in with email and password
 */
export const loginWithEmail = async (email, password) => {
  const userCredential = await signInWithEmailAndPassword(
    auth,
    String(email || '').trim(),
    String(password || '')
  )
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

const NAME_PLACEHOLDERS = new Set(['employee', 'employee staff', 'team staff', 'unknown', 'user'])

function isUsableDisplayName(value) {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed || trimmed === '—' || trimmed === '-') return false
  return !NAME_PLACEHOLDERS.has(trimmed.toLowerCase())
}

function pickDisplayName(...values) {
  for (const value of values) {
    if (isUsableDisplayName(value)) return value.trim()
  }
  return ''
}

function collectIdentityValues(...values) {
  const out = []
  const seen = new Set()
  for (const value of values) {
    if (value == null || value === '') continue
    if (typeof value === 'object') continue
    const key = String(value)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

async function findEmployeesByEmail(email) {
  const normalized = String(email || '').trim().toLowerCase()
  if (!normalized) return []

  const all = await getDocs(collection(db, 'employees'))
  return all.docs
    .filter((d) => String(d.data()?.email || '').trim().toLowerCase() === normalized)
    .map((d) => ({ empId: d.id, empData: d.data() || {} }))
}

/**
 * Fetch a user document from Firestore /users/{uid} merged with /employees/{uid}.
 * /users is checked first for auth fields, but a missing name is filled from the employee profile.
 * If the employee row is keyed differently from the profile id, look it up by email.
 */
export const getUserDoc = async (uid, emailHint) => {
  try {
    const userRef = doc(db, 'users', uid)
    const empRef = doc(db, 'employees', uid)
    const [snap, empSnap] = await Promise.all([getDoc(userRef), getDoc(empRef)])
    const userData = snap.exists() ? snap.data() : null
    let empId = empSnap.exists() ? empSnap.id : null
    let empData = empSnap.exists() ? empSnap.data() : null
    const lookupEmail = emailHint || userData?.email || empData?.email
    const emailMatches = lookupEmail ? await findEmployeesByEmail(lookupEmail) : []
    const extraEmpIds = []
    const extraEmpUids = []
    for (const hit of emailMatches) {
      extraEmpIds.push(hit.empId)
      extraEmpUids.push(hit.empData?.uid, hit.empData?.id, hit.empData?.employeeId)
      if (!empData) {
        empId = hit.empId
        empData = hit.empData
      }
    }

    if (!userData && !empData) return null

    const merged = {
      ...(empData || {}),
      ...(userData || {}),
      uid: userData?.uid || uid,
      id: userData?.id || uid,
      employeeId: empData?.employeeId || empId || extraEmpIds[0] || userData?.employeeId || uid,
      employeeDocId: empId || extraEmpIds[0] || null,
      auth_id: userData?.auth_id || empData?.auth_id || userData?.authId || empData?.authId || null,
    }
    merged.identityIds = collectIdentityValues(
      merged.uid,
      merged.id,
      merged.employeeId,
      merged.employeeDocId,
      merged.auth_id,
      empData?.uid,
      empData?.id,
      empData?.employeeId,
      userData?.uid,
      userData?.id,
      uid,
      empId,
      ...extraEmpIds,
      ...extraEmpUids
    )
    const emailLocal = String(merged.email || lookupEmail || '').split('@')[0]
    if (!merged.email && lookupEmail) merged.email = lookupEmail
    merged.displayName =
      pickDisplayName(
        userData?.displayName,
        empData?.displayName,
        empData?.name,
        empData?.fullName,
        userData?.name,
        emailLocal
      ) || merged.displayName || ''
    if (!merged.departmentName && empData?.departmentName) {
      merged.departmentName = empData.departmentName
    }
    if (!merged.role) merged.role = 'employee'

    const userQuoteAt = Date.parse(userData?.quoteUpdatedAt || '') || 0
    const empQuoteAt = Date.parse(empData?.quoteUpdatedAt || '') || 0
    const userHasQuote = !!(userData && ('quote' in userData || 'proverb' in userData))
    const empHasQuote = !!(empData && ('quote' in empData || 'proverb' in empData))
    const useEmpQuote = empHasQuote && (!userHasQuote || empQuoteAt > userQuoteAt)
    const quoteSource = useEmpQuote ? empData : userData
    if (quoteSource && ('quote' in quoteSource || 'proverb' in quoteSource)) {
      const text = quoteSource.quote || quoteSource.proverb || ''
      merged.quote = text
      merged.proverb = text
      merged.quoteUpdatedAt = quoteSource.quoteUpdatedAt || userData?.quoteUpdatedAt || empData?.quoteUpdatedAt
    }

    return merged
  } catch (err) {
    console.warn('Error fetching user document:', err.message)
  }
  return null
}

/**
 * Ensure user document exists in /users/{uid}
 */
export const ensureUserDocExists = async (user) => {
  if (!user) return
  if (import.meta.env.VITE_FIREBASE_API_KEY === 'mock_api_key_dev') return

  try {
    const userRef = doc(db, 'users', user.uid)
    const snap = await getDoc(userRef)

    if (!snap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || user.email?.split('@')[0] || 'Employee',
        photoURL: user.photoURL || null,
        phoneNumber: user.phoneNumber || null,
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
