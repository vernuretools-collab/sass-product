import { useEffect } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { auth, db } from '../../shared/services/firebaseService'
import { fetchCustomClaims, ensureUserDocExists } from '../../shared/services/authService'
import { useUserStore } from '../../shared/stores/userStore'
import { useOrgStore } from '../../shared/stores/orgStore'

export const useAuth = () => {
  const { setUser, clearUser } = useUserStore()
  const { setOrg, setMembership, setPermissions, clearOrg } = useOrgStore()

  useEffect(() => {
    // In local dev/mock mode, skip Firebase network listeners
    if (import.meta.env.VITE_FIREBASE_API_KEY === 'mock_api_key_dev') {
      return
    }

    let unsubscribeUserDoc = null
    let unsubscribeOrgDoc = null
    let unsubscribeMemberDoc = null

    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        clearUser()
        clearOrg()
        return
      }

      try {
        await ensureUserDocExists(firebaseUser)
        const claims = await fetchCustomClaims(firebaseUser)

        const userRef = doc(db, 'users', firebaseUser.uid)
        unsubscribeUserDoc = onSnapshot(
          userRef,
          async (userSnap) => {
            const userDocData = userSnap.data() || null

            if (userDocData?.claimRefreshTrigger) {
              const freshClaims = await fetchCustomClaims(firebaseUser, true)
              setUser(firebaseUser, userDocData, freshClaims)
            } else {
              setUser(firebaseUser, userDocData, claims)
            }
          },
          (err) => {
            console.warn('User doc snapshot offline warning:', err.message)
            setUser(firebaseUser, null, claims || { orgId: null, role: 'employee', tier: 'company' })
          }
        )

        const activeOrgId = claims?.orgId || null

        if (activeOrgId) {
          const orgRef = doc(db, 'organizations', activeOrgId)
          unsubscribeOrgDoc = onSnapshot(
            orgRef,
            (orgSnap) => {
              if (orgSnap.exists()) {
                setOrg(orgSnap.data())
              }
            },
            (err) => console.warn('Org snapshot offline warning:', err.message)
          )

          const memberRef = doc(db, `organizations/${activeOrgId}/members`, firebaseUser.uid)
          unsubscribeMemberDoc = onSnapshot(
            memberRef,
            (memberSnap) => {
              if (memberSnap.exists()) {
                const memberData = memberSnap.data()
                setMembership(memberData)
                setPermissions([...(memberData.permissions || [])])
              }
            },
            (err) => console.warn('Member snapshot offline warning:', err.message)
          )
        } else {
          clearOrg()
        }
      } catch (err) {
        console.warn('Error establishing user session context:', err)
        setUser(firebaseUser, null, { orgId: null, role: 'employee', tier: 'company' })
      }
    })

    return () => {
      unsubscribeAuth()
      if (unsubscribeUserDoc) unsubscribeUserDoc()
      if (unsubscribeOrgDoc) unsubscribeOrgDoc()
      if (unsubscribeMemberDoc) unsubscribeMemberDoc()
    }
  }, [setUser, clearUser, setOrg, setMembership, setPermissions, clearOrg])

  return {}
}
