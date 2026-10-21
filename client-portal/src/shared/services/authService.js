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
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'

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
        displayName: user.displayName || user.email.split('@')[0],
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
