import { useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { supabase } from './client.js'
import { isJoiningRole } from './employeeOnboarding.js'
import { rejectSuspendedCompany } from './companyStatus.js'

export function useLiveAuthSession({ auth, useUserStore, fetchCustomClaims }) {
  const user = useUserStore((s) => s.user)
  const setUser = useUserStore((s) => s.setUser)
  const clearUser = useUserStore((s) => s.clearUser)
  const [sessionReady, setSessionReady] = useState(!supabase)

  useEffect(() => {
    if (!supabase) {
      setSessionReady(true)
      return undefined
    }
    const unsub = onAuthStateChanged(auth, async (sessionUser) => {
      try {
        if (!sessionUser) {
          clearUser()
          return
        }
        const claims = await fetchCustomClaims(sessionUser, true)
        try {
          await rejectSuspendedCompany(() => supabase.auth.signOut())
        } catch (err) {
          if (err?.code === 'company-suspended') {
            clearUser()
            return
          }
          throw err
        }
        const state = useUserStore.getState()
        const mergedClaims = {
          ...(state.claims || {}),
          ...(claims || {}),
          orgId: claims?.orgId || state.claims?.orgId || null,
          role: isJoiningRole(claims?.role)
            ? claims.role
            : (state.userDoc?.role || claims?.role || state.claims?.role || 'employee'),
          tier: claims?.tier || state.claims?.tier || 'company',
        }
        setUser(sessionUser, state.userDoc || null, mergedClaims)
      } finally {
        setSessionReady(true)
      }
    })
    return unsub
  }, [auth, useUserStore, fetchCustomClaims, setUser, clearUser])

  return { user, sessionReady }
}
